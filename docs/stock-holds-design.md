# Stock Holds — Design Spec

Date: 2026-08-08
Status: Approved, pending implementation

## Problem

When a picker marks a line **not-found** during picking, only the *picked* quantity is
deducted from that stock lot (see `applyPicks` in `src/lib/store.ts`). The not-found
remainder stays showing as available. The next time demand comes in for that SKU —
either a round-2 alternate on the same task, or an entirely new picklist generated
later — the allocator can offer that exact same SKU + Facility + Bin + Batch lot
again, which is likely to fail again for the same physical reason (mislabeled,
missing, miscounted stock).

## Requirement

Whenever a line is marked not-found, that exact **SKU + Facility + Bin + Batch**
combination goes **on hold**: excluded from all future allocation (fresh picklists
and round-2 alternates alike) until an Admin or Super Admin explicitly releases it
(Planner can view the hold list, not release). The hold is scoped to that exact
combination only — a different SKU sitting on the same bin, or the same SKU in a
different bin/batch, is unaffected. It also records the qty actually put on
hold: the shelf's current stock level right after the picked amount is
deducted — e.g. bin qty 100, pick qty 10, picked 5, not-found 5 → 95 held
(100 − 5), not 5. The bin can hold far more than any single picklist asked
for, so the hold covers everything left at that shelf, not just the
shortfall.

## Why not key on the stock row's internal ID

Every stock row already gets a `rid`, but it's assigned as a row-order counter each
time stock is (re)synced from the inventory email (`rowsFromTuples` / `fetchStock`),
not a stable identity. A hold keyed on `rid` would silently stop matching the
correct lot after the very next sync. Holds must be keyed on the real-world identity:
`sku + facility + bin + batch`.

## Data model — new table `stock_holds`

A dedicated table, not a JSONB blob on an existing row, because multiple people
(different supervisors, different browser sessions) may place or release holds
around the same time — a single shared JSON blob risks one write silently
clobbering another. A real table also gives a permanent audit trail: releasing a
hold never deletes the row, it just stamps `released_at`/`released_by`, matching
the existing "archive, don't delete" pattern already used for picklists.

```sql
create table stock_holds (
  id bigint generated always as identity primary key,
  sku text not null,
  facility text not null,
  bin text not null,
  batch text not null,
  qty integer not null default 0, -- not-found qty that triggered the hold
  held_at timestamptz not null default now(),
  held_by text not null,
  reason text,
  source_task_no text,
  released_at timestamptz,
  released_by text
);

alter table stock_holds enable row level security;

create policy "authenticated read" on stock_holds
  for select to authenticated using (true);

-- Picker completes a picklist with a not-found line -> a hold gets created
-- automatically, so insert must allow every role that can complete a picklist.
create policy "assigned roles create holds" on stock_holds
  for insert to authenticated
  with check (current_role_name() in ('planner', 'admin', 'super_admin', 'picker'));

-- Only Admin/Super Admin may release a hold (Planner can see the list, but
-- not clear it — release is an Admin-tier action).
create policy "admin release holds" on stock_holds
  for update to authenticated
  using (current_role_name() in ('admin', 'super_admin'))
  with check (current_role_name() in ('admin', 'super_admin'));
```

This reuses the `current_role_name()` helper function already defined in
`supabase/schema_step3_complete.sql` — no need to redefine it.

An **active hold** is any row where `released_at is null`. The user will run this
SQL once in the Supabase SQL editor — no service-role key is available to run it
automatically.

## Enforcement

`allocate()` in `src/lib/engine.ts` already filters out damaged/inactive stock and
CC-NTF exception bins. Add one more filter there: skip any stock row whose
`sku::facility::bin::batch` key is in the current set of active-hold keys. Because
this is the single shared allocation primitive, adding the check there
automatically covers:

- `computeChannelAllocations()` → `generate()` (brand-new picklists)
- the round-2 not-found-alternate waterfall inside `applyPicks()`

`allocate()` gains an optional `heldKeys?: Set<string>` argument; `waterfall()` and
`computeChannelAllocations()` thread it through unchanged otherwise.

## Auto-creating a hold

Inside `applyPicks()`, for every resolved line where `nf > 0` (not-found qty > 0),
place a hold for that line's `(sku, facility, bin, batch)` — `facility` comes from
the enclosing `FacilityPicklist.facility`. `held_by` is the display name of whoever
completed the picklist (threaded in as a new optional parameter to `applyPicks`,
sourced from `useAuth().profile?.display_name` at each call site: `FacilityBlock.tsx`
and `PickerView.tsx`). `reason` is the picker's `nfReason` if given. `source_task_no`
is the parent task's `no`, for traceability.

Placing a hold is idempotent on the natural key: if an active hold already exists
for that exact combination, don't insert a duplicate row.

## Releasing a hold

New store actions `loadHolds()` / `placeHold(...)` / `releaseHold(id, releasedBy)`,
following the same Supabase read/write pattern already used for `tasks`. A new
`holds: Hold[]` field on the Zustand store, loaded on app start and refreshed after
any place/release action (no realtime subscription needed for v1 — holds change
far less often than picklists).

## UI

New "Stock Holds" screen, visible to **Admin, Super Admin, and Planner** (not
Picker) — added as a nav item in the existing "shared" section (alongside
Inventory). Planner can see the list for operational visibility; only Admin
and Super Admin see the "Release" button (matching the RLS policy).
Shows every active hold: SKU, product name, Facility, Bin, Batch, not-found
qty, held-since,
held-by, reason, source picklist — with a "Release hold" button per row. A small
badge count (mirroring the existing unassigned-picklist badge pattern) makes the
count visible without opening the tab.

## Out of scope for this pass (flagged, not building now)

- Surfacing an "On hold" tag directly inside Inventory or Not-Found Summary rows —
  useful, but additive; can follow up once the core mechanism is live.
- Realtime sync of the holds list across open sessions — polling / refresh-on-action
  is enough for how infrequently holds change.
- Bulk release ("release all"). Given holds represent a real, unresolved physical
  problem on a specific shelf, one-at-a-time release (each a deliberate check) is
  the safer default — a "release all" button would make it too easy to wave through
  problems that haven't actually been checked. Skipping unless requested.

## Testing plan

- Pure unit tests for the new `allocate()` held-key filtering (same style as
  existing `engine.test.ts`): held combination excluded, different SKU same bin
  still allocatable, different batch same SKU+bin still allocatable.
- Unit test for the auto-hold-on-not-found logic extracted as a pure function
  (mirroring how `resolvePickLine` is pure and separately tested), so it doesn't
  require a live Supabase call to verify.
- No change to existing FEFO/engine test expectations other than the new
  behavior being additive (holds default to none).
