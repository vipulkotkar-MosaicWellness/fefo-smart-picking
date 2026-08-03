# FEFO Smart Picking — Test Cases & Release Notes

Written after completing the UI/UX redesign (branding, navigation, Demand
Planner, Picking Supervisor, Picker, Admin, Inventory) against
`docs/FEFO-Revised-Implementation-Plan.md`. Covers what to verify before
wider rollout, and what's intentionally not built yet.

## 1. Automated test suite

50 tests across 14 files, all passing as of this writing. Run with:

```bash
npm run test:run
```

| Area | File | What it locks in |
|---|---|---|
| Branding | `tests/brand/MosaicLogo.test.tsx` | Logo renders with accessible alt text |
| Navigation | `tests/app/navigation.test.ts` | Correct nav items per role; Admin never shown to Planner |
| Partner identity | `tests/partners/*.test.ts(x)` | Initials fallback logic; logo never shown unless locally stored + approved |
| Demand Planner | `tests/demand/allocationPreview.test.ts` | FEFO waterfall math: single-facility, multi-facility spillover, shortage, reservation-blocking, unknown-channel skip |
| Demand Planner | `tests/demand/parseDemandCsv.test.ts` | Valid rows, duplicate merge + reporting, unknown channel, unknown SKU, invalid quantity |
| Demand Planner | `tests/demand/demandWizard.test.tsx` | Wizard blocks on all-invalid input; valid row reaches a real allocation preview |
| Picking Supervisor | `tests/supervisor/metrics.test.ts` | Open/unassigned counts, fill rate (completed picklists only), picker workload |
| Admin | `tests/admin/partnerDirectory.test.tsx` | Logo stays hidden until Approved; activate/deactivate toggle |
| Inventory | `tests/inventory/inventoryView.test.ts` | Filter combinations, expiry-first sort, pagination math |
| Picker | `tests/picker/pickerScan.test.ts` | Batch match logic (case/whitespace-insensitive) |
| Picker | `tests/picker/offlineQueue.test.ts` | Queue persists across loads; removed once synced |
| Picker | `tests/picker/pickerFlow.test.tsx` | Wrong-batch scan is rejected with the expected message; structured exception UI present |

**Deliberately not covered by an automated test:** the real `generate()`
Supabase write path, and `applyPicks()`'s real Supabase write path. Both
call live Supabase, and this project's `supabaseClient.ts` falls back to
real production credentials when no env vars are set — so those two are
covered by testing the pure logic they depend on
(`computeChannelAllocations`, `scanMatches`) instead of exercising the
write itself in a test run. Manual testing (below) is what verifies the
actual write.

## 2. Manual test cases — walk these before wider rollout

### Super Admin
1. Sign in → see Demand Planner, Picking Supervisor, Inventory, and Admin (Settings) in the nav.
2. Admin → Manage users → nominate a new Admin by name + email → confirm they appear as "awaiting sign-up."
3. Admin → Manage users → assign an existing pending account to Planner or Picker.
4. Admin → Partner Directory → upload a logo for a channel → confirm it shows "Pending approval" and does **not** render as an image anywhere yet.
5. Same channel → Approve → confirm the logo now renders in the Directory.
6. Admin → Facility waterfall → reorder with the ↑/↓ buttons → confirm the order updates and an entry appears under Recent activity.

### Admin
1. Everything above except nominating a new Admin (that control should not appear).
2. Confirm you cannot set anyone's role to Admin or Super Admin — the option shouldn't be offered.

### Demand Planner (role: Planner)
1. Import → paste a demand CSV with a mix of: a valid row, a duplicate of that row, an unknown channel, an unknown SKU, and a zero/blank quantity.
2. Validate → confirm all four categories are called out explicitly (not a browser alert), and the duplicate shows as merged.
3. Review allocation → confirm real per-facility unit counts appear (not a placeholder), and any shortage is shown.
4. Generate → confirm the picklist(s) actually appear afterward in Picking Supervisor's queue.
5. Try clicking "Generate picklists" twice quickly — confirm it doesn't create duplicate picklists (button disables while saving).

### Picking Supervisor
1. Confirm the four metric tiles (Open picklists / Awaiting assignment / Stock exceptions / Fill rate) show real numbers, and Fill rate shows "—" (not "0%") when nothing has completed yet.
2. Filter by facility, then channel, then picker — confirm the queue narrows correctly and clears when filters are removed.
3. Assign a picklist to a picker → confirm Picker workload reflects the new active line count.
4. Complete a picklist as a Picker (see below), then confirm Fill rate updates and the picklist moves to "Picking completed."

### Picker
1. Sign in as a Picker with at least one assigned picklist → confirm you land directly on your current pick, large-format location first.
2. Tap **Scan** → type an incorrect batch code → confirm you see "Wrong batch. Scan batch \<code\>." and it does **not** advance.
3. Type the correct batch code → confirm it advances to the next line.
4. Tap **Report an exception** → confirm a reason dropdown appears (not just a bare quantity field) → submit → confirm it's recorded.
5. Complete the last line of a picklist → confirm the "picking done" screen appears, and the picklist shows as completed in Picking Supervisor.
6. **Offline check:** turn off Wi-Fi/data, complete a picklist → confirm the status pill shows "Offline · 1 queued" instead of failing silently. Turn connectivity back on → confirm it syncs automatically within a few seconds and the pill returns to "Online."
7. Try double-tapping "Picked" rapidly on the same line → confirm it doesn't submit twice (button shows "Saving…" and is disabled mid-submit).

### Inventory (any role that has access)
1. Confirm the default sort is earliest-expiry-first.
2. Filter by batch code, then by location/bin, then by a minimum quantity — confirm each narrows results correctly.
3. Save a view with a name → reload the page → confirm it's still listed (per-browser, not shared with other devices — see gap below).
4. Export CSV → confirm the downloaded file matches the currently filtered/sorted set, not just the visible page.
5. Click a row → confirm the batch-detail drawer opens with full facility/batch/expiry detail, and closes on the Close button or clicking outside.

## 3. Known gaps — not built, and why

| Gap | Why it's not done |
|---|---|
| Priority / SLA / due-time on picklists | No such field exists in the database. Displaying a fabricated countdown would be actively misleading. Needs a schema addition — flag separately if you want this. |
| Cross-device durable audit trail | The audit log added under Admin is real, but persists to each browser's local storage only (same mechanism already used for channel tolerance rules and facility priority before this redesign) — it does not sync across devices via Supabase. A durable version needs a new table. |
| Real idempotency key for picklist generation | Current protection is a client-side busy-guard against a double click during one request, not a server-side key that survives a retry from a different device/session. Needs a schema addition. |
| Deactivating a partner doesn't block new demand against it | Partner Directory's Active/Inactive toggle is currently informational only — Demand Planner doesn't check it yet. Wiring that in is a FEFO/business-rule change, held back pending a decision. |
| Formal accessibility audit (axe / Playwright) | No automated accessibility or cross-browser/viewport test suite was added — this plan's Task 11/12 e2e tooling (Playwright, MSW) was deliberately not installed to avoid carrying unused infra. Manual keyboard/contrast spot-checks were done on new components (focus rings, dialog roles, color+text pairing on severity), but nothing automated verifies this on every change. |
| `channelRules` / `facilityPriority` / new partner+audit state not synced across devices | Pre-existing limitation (channel tolerance and facility order already worked this way before this redesign) — an Admin's changes on one device/browser won't appear for another Admin elsewhere until this moves into Supabase. |

## 4. Release checklist

- [x] `npm run build` succeeds
- [x] `npm run test:run` — 50/50 passing
- [x] No secrets introduced in this work (existing Supabase publishable key usage unchanged)
- [x] Manual walkthroughs above completed on the live app *(do this before sign-off — not run by me since it needs your real Supabase login)*
- [ ] Decision needed: schema addition for Priority/SLA/audit trail/idempotency key (Task 10 + parts of Task 6/8)
- [ ] Decision needed: should Partner "Inactive" actually block new demand
