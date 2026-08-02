# FEFO redesign — repository path map

Recorded before Phase 1 implementation, per the FEFO Revised Implementation
Plan's preflight gate.

## Detected stack

- **Entry point:** `src/main.tsx` → `src/App.tsx` (single component tree, no
  routes — role decides which panels render via conditional JSX).
- **Router:** none. `App.tsx` is a single-page conditional shell; there is no
  `react-router` (or any router) dependency and no URL-addressable views.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`, utility classes
  in-component. No CSS token file exists yet.
- **State:** Zustand (`src/lib/store.ts`, `src/lib/authStore.ts`,
  `src/lib/pickersStore.ts`), some with `persist` middleware.
- **Supabase client:** `src/lib/supabaseClient.ts`. Direct Supabase calls are
  spread across `src/lib/supabaseStock.ts`, `src/lib/tasksSupabase.ts`, and
  `src/lib/authStore.ts` — there is no single typed adapter layer yet.
- **FEFO allocation code:** `src/lib/engine.ts` (`allocate`, `cutoffMonths`,
  `criticalPathSort`, `monthsRemaining`) plus the waterfall/task logic in
  `src/lib/store.ts`. This is the logic the plan requires to be preserved
  byte-for-byte.
- **Current role components:** `AdminConfig`, `AdminUsers`, `DemandPanel`,
  `SupervisorQueue`, `PerformancePanel`, `PicklistRepository`,
  `InventoryPanel`, `PickerView`, all under `src/components/`.
- **Roles today:** `super_admin`, `admin`, `planner` (already collates
  Demand Planner + Picking Supervisor — see commit `7a6cab3`), `picker`. The
  plan's original nav model listed Planner and Supervisor as separate roles;
  that's now reconciled by giving one person (role `planner`) two adjacent
  nav destinations instead of two separate roles.
- **Test runner:** none. No Vitest, Testing Library, jsdom, MSW, or
  Playwright in `package.json`, and no `tests/` or `e2e/` directory.
- **Build:** `tsc -b && vite build` (see `package.json`).

## Proposed-file → actual-file mapping

| Plan's proposed path | Actual repo destination | Notes |
|---|---|---|
| `src/app/App.tsx` | `src/App.tsx` (modify in place) | No `app/` subfolder; keep existing entry point. |
| `src/app/AppShell.tsx` | `src/components/AppShell.tsx` | New. Wraps the existing role-conditional body; no router introduced (see decision below). |
| `src/app/navigation.ts` | `src/lib/navigation.ts` | New. Matches existing `src/lib/*` convention for non-component modules. |
| `src/assets/brand/mosaic-wellness.png` | `src/assets/brand/mosaic-wellness.png` | New folder. Source: the approved logo already shipped in the prototype (`reference/fefo-ui-prototype/public/mosaic-wellness.png`) — reused locally, not re-fetched. |
| `src/components/brand/MosaicLogo.tsx` | `src/components/brand/MosaicLogo.tsx` | New. |
| `src/components/partners/PartnerMark.tsx` | `src/components/partners/PartnerMark.tsx` | New. |
| `src/components/status/StatusChip.tsx` | `src/components/status/StatusChip.tsx` | New. |
| `src/features/partners/*` | `src/lib/partners.ts` + `src/lib/partnerTypes.ts` | Flattened to match this repo's `lib/` (not `features/`) convention. |
| `src/features/demand/*` | Extends `src/components/DemandPanel.tsx` | Existing component, not a new `features/` tree — reworked in place. |
| `src/features/supervisor/*` | Extends `src/components/SupervisorQueue.tsx` | Same. |
| `src/features/picker/*` | Extends `src/components/PickerView.tsx` | Same. |
| `src/features/admin/*` | Extends `src/components/AdminConfig.tsx` / `AdminUsers.tsx` | Same. |
| `src/features/inventory/InventoryPage.tsx` | `src/components/InventoryPanel.tsx` (already shared) | Already a shared secondary panel, not duplicated per role — requirement #8 is largely already met. |
| `src/services/fefoService.ts` | `src/lib/engine.ts` (do not modify logic) | Existing FEFO adapter; only wrap, never rewrite the allocation math. |
| `src/services/operationsService.ts` | `src/lib/tasksSupabase.ts` + `src/lib/supabaseStock.ts` | Existing Supabase access; a typed adapter layer is additive scope, tracked separately (see below), not required for the Phase 1 visual/nav work. |
| `src/styles/tokens.css` | `src/styles/tokens.css` | New. Layered under the existing Tailwind setup, not a replacement for it. |
| `tests/**`, `e2e/**` | `tests/**`, `e2e/**` | New — this repo has no test harness today. |

## Conflicts and decisions needing sign-off before Phase 1 continues

1. **No router exists.** The plan's nav/shell assumes route-addressable
   screens (`to: '/demand'`, etc.). Introducing `react-router` is a real
   infrastructure addition, not implied by "UI redesign" alone. Recommended:
   keep the existing pattern — a shell that switches which panel renders
   based on a `view` selection (same mechanism `App.tsx` already uses for
   role), so the visual/nav upgrade ships without adding a new routing
   dependency. This can be swapped for real routing later if URL-sharing
   between panels becomes a real need.
2. **No test harness exists.** Task 1 installs Vitest + Testing Library +
   jsdom + jest-dom + user-event now (needed for Phase 1's own TDD steps).
   MSW and Playwright are deferred until the tasks that actually exercise
   them (Task 10 services layer, Task 11/12 e2e) so Phase 1 doesn't carry
   unused dependencies.
3. **`operationsService.ts` typed adapter is out of scope for Phase 1.** It
   touches working Supabase call sites across the app. Per "do not perform
   unrelated backend refactoring," this is deferred to its own explicitly
   approved phase (matches the plan's own Task 10), not bundled into the
   branding/shell/partner-registry work.
4. **Role/nav reconciliation.** Demand Planner and Picking Supervisor remain
   two separate navigation destinations (matching the approved prototype and
   plan), but both map to the single `planner` role already in production —
   no second role is reintroduced.
