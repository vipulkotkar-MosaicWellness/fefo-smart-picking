# HHT Scan-to-Confirm Picking Design

## Problem

Today, picking confirmation (`PickerView.tsx`) is entirely manual: a picker is shown an instructed bin/product/batch/quantity and taps either "✓ Found — Picked" or "Not found" — nothing checks that they're actually at the right shelf or holding the right product before they confirm. Two concrete risks follow from this:

1. **Wrong-bin / wrong-product picks go undetected until later.** The picker's word is the only check. (Note: this doesn't cover *batch*-level correctness — see Explicitly out of scope.)
2. **"Not found" requires no proof of presence.** A picker can report a bin empty/wrong without the system ever confirming they went there.

The business now has dedicated Android handheld scanner devices (HHTs) on the warehouse floor with a hardware scan engine (trigger-button laser/imager, not a phone camera), and wants picking on those devices to require a scan-based check before a pick can be confirmed.

## Design

### 1. Technical approach: extend the existing web app, don't build a separate native app

These Android HHTs' scan engines operate in **keyboard-wedge mode**: pressing the trigger reads a barcode and types it into whatever text field currently has focus, followed by Enter — the same as if someone had typed it and pressed Enter. This means scanning can be added as a new step inside the *existing* `PickerView` screen (same login, same URL, same backend) by focusing a text input at the right moment and reading what lands in it. No native Android app, no separate codebase, no APK distribution.

**Deployment: PWA.** The existing web app gains a PWA manifest + service worker so it installs to the HHT's home screen and opens full-screen (no browser address bar), so it looks and feels like a dedicated app. Login is unchanged (same Supabase email/password sign-in already in place).

**Explicitly out of scope / open item:** device kiosk-lockdown (preventing a picker from leaving the app to use anything else on the HHT) was raised and not confirmed either way. This design assumes a normal installable PWA, **not** locked down — revisit as a separate follow-up if needed, since true kiosk mode requires Android device-owner/MDM enrollment, a materially bigger undertaking than the PWA itself.

### 2. New reference data: EAN → SKU mapping

The system currently has no barcode field anywhere (`types.ts`, `StockRow`) — products are tracked only by internal SKU (e.g. `MWMMSKP.5002.AAAA.B0_N`), not by the EAN printed on the carton. A scanned EAN has nothing to check itself against without this.

Add a new small reference table, `ean_map` (`ean text primary key`, `sku text not null`), uploaded/maintained by Vipul's team the same way stock CSVs are uploaded today (`InventoryUploadFallback.tsx` / `shelfwiseCsv.ts` pattern) — a simple two-column CSV, re-uploadable to add or correct mappings. No changes to `StockRow`/`PickLine` are needed; this is a standalone lookup table consulted only at scan time.

### 3. Per-picker HHT configuration

The existing `pickers` table (`src/lib/pickersSupabase.ts`) is a flat roster of names used today for the "assign to" dropdown. Add one column: `requires_scan boolean not null default false`, editable wherever the picker roster is already managed. `PickerView` looks up the signed-in picker's own roster row (matched by `display_name`, the same match already used for `l.picker === myName`) and reads this flag to decide which flow to render:

- `requires_scan = true` → the new scan-gated flow (section 4/5 below).
- `requires_scan = false` (default, unchanged for everyone until explicitly flipped) → today's flow, completely untouched.

This is a per-person setting, not per-device or per-facility, so it follows a picker even if their physical device changes, and requires no hardware detection.

### 4. Normal picking workflow (scan-required pickers)

1. Picker opens their assigned picklist — same list/line view as today (bin, product, batch, qty shown).
2. **New — Scan bin:** screen prompts "Scan the bin label," focuses a hidden input, and waits. On scan:
   - Matches `line.bin` → proceeds to step 3.
   - Doesn't match → inline error naming both the expected and scanned bin; picker must locate the correct bin and rescan. Nothing is recorded yet.
3. **New — Scan product:** screen prompts "Scan the product," focuses the input again. On scan:
   - The EAN resolves (via `ean_map`) to `line.sku` → proceeds to step 4.
   - The EAN resolves to a different SKU, or isn't in `ean_map` at all → same inline-error treatment as a bin mismatch.
4. Picker confirms quantity via the existing "✓ Found — Picked" control (unchanged).
5. The pick is saved through the existing `applyPicks` action, unchanged, with one addition: the line is tagged as scan-verified (see Data model below). No other part of the save path changes — the same not-found re-offer, hold-placement, gate-pass, and adherence-scoring logic already in place picks this up automatically.

**Explicitly out of scope:** batch-level scan verification. Batches have no scannable barcode today (confirmed — EAN is shared across every batch of a product), so the batch number is still read and trusted from the shelf label by the picker, exactly as today. A batch-mismatch (like GPSLMH10477) is not caught by this design; it's noted as a possible future phase if/when batch-level labels are introduced.

### 5. Not-found workflow (scan-required pickers)

Same entry point as today ("Not found" from the line screen), with one change: **the bin scan (step 2 above) is required first**, even when the outcome will be "not found" — this is the one part of the flow that applies regardless of outcome, since its purpose is proving the picker was physically at the correct shelf before reporting it empty/wrong. The product-scan step does not apply (there's nothing to scan if the item isn't there). After a successful bin scan, the existing "Not found" reason/quantity flow proceeds unchanged.

### 6. Escape hatch: scanner or label problems

Real shelves have damaged/missing labels and scanners occasionally fail. Add a "Can't scan — continue manually" option, available from either scan step, which requires selecting a reason (mirroring the existing not-found-reason pattern) before letting the picker proceed without that scan. This keeps a manual path available without silently disabling verification — the reason is visible to supervisors, same as a not-found reason is today.

### 7. Data model additions

- `pickers.requires_scan boolean not null default false` (new column, existing table).
- New `ean_map` table: `ean text primary key`, `sku text not null`.
- `PickLine` gains an optional field, e.g. `scanVerified?: { bin: boolean; product: boolean }` (or a single `scanVerified?: boolean` if per-field detail isn't needed — to be settled during planning), plus an optional `scanOverrideReason?: string` for the escape-hatch path. Written by `applyPicks`, read nowhere else in this phase except future reporting.

## Explicitly out of scope (this phase)

- Batch-level scan verification (needs new scannable batch labels — a physical labeling change, not just software).
- Kiosk-mode device lockdown (needs Android device-owner/MDM enrollment — separate effort if wanted later).
- Auto-detecting whether a device has a real hardware scanner (deliberately using an explicit per-picker admin setting instead, since browser-side hardware detection for this class of device is unreliable).
