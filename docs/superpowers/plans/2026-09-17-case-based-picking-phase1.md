# Case-Based Picking (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the picking engine case-aware — for a SKU with a configured case size, suggest full cases first (FEFO order, one case only ever from a single bin), then loose eaches for whatever remains — while leaving every SKU without a case size, and every other subsystem (holds, gate pass, shortfall, not-found, WMS export), behaving exactly as today.

**Architecture:** Purely additive. `PickLine` gains two optional fields (`caseQty`/`eachQty`) that always sum to the existing `qty`, which never changes meaning — so anything that only reads `qty` (17 of the 22 files that touch pick lines) needs zero changes. A new small Supabase table (`case_sizes`, SKU → case size) is synced live the same way `channel_overrides` already is. The allocation change lives in exactly one function, `allocate()` in `engine.ts`, gated on whether a case size was supplied for that call — omitted or ≤1, it's byte-for-byte today's behavior.

**Tech Stack:** TypeScript, Zustand, Supabase (Postgres + Realtime), Vitest.

**Business context (for whoever picks this up):** management gave conditional approval after a 9-day real-data simulation found this trades away ~0.9% of picked volume's FEFO-purity (8,080 of 880,905 units over Aug 25–Sep 2 would ship from a non-nearest-expiry batch — concentrated in a handful of large-case/fragmented-lot SKUs, not diffuse) in exchange for picking speed. A slotting/putaway fix (Phase 2, separate plan, tied to the EasyEcom rotation) is expected to shrink that cost further later — this plan is Phase 1 only: the picking engine itself.

**Sequencing:** Task 1 (type) has no dependents-order requirement but logically comes first. Task 2 (engine) is the core and should be done and fully tested before Tasks 4-5 wire it in, since those tasks' own tests assume Task 2's exact behavior. Tasks 3-4 (data table + store wiring) can happen in parallel with Task 2 but must land before Task 5 (which needs live `caseSizes` in the store). Tasks 6-9 (display, admin UI, export, backfill) are independent of each other once Task 5 is done.

---

### Task 1: Add `caseQty`/`eachQty` to `PickLine`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Make the change**

In `src/lib/types.ts`, replace the `PickLine` interface:

```ts
export interface PickLine {
  rid: number;
  sku: string;
  name: string;
  facility: string;
  bin: string;
  batch: string;
  vendorBatch?: string;
  exp: Expiry;
  rem: number; // remaining months at pick time
  qty: number; // suggested pick qty — always caseQty + eachQty when either is set, unchanged meaning otherwise
  // Case-based picking (see engine.ts allocate()): set only when this SKU
  // has a configured case size AND this lot contributes a full case and/or
  // loose eaches. Both omitted (undefined) is today's plain FEFO line —
  // every existing reader of `qty` needs no changes at all.
  caseQty?: number; // full cases suggested from this lot
  eachQty?: number; // loose units suggested from this lot, on top of or instead of caseQty
  nf?: number; // not-found qty entered on completion
  nfReason?: string; // picker's reason for the not-found qty, e.g. "Damaged stock"
  picked?: number; // actual picked (qty - nf)
  picker?: string; // assigned picker (child-picklist stage)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (this is an additive, all-optional change — nothing currently constructs a `PickLine` needs to change).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add optional caseQty/eachQty to PickLine for case-based picking"
```

---

### Task 2: Two-pass case-first allocation engine

**Files:**
- Modify: `src/lib/engine.ts`
- Test: `tests/engine/caseFirstAllocation.test.ts`

The core of this feature. `allocate()` gets one new optional arg, `caseSize?: number`. Omitted or ≤1: today's exact single-pass FEFO loop, unchanged. Set and >1: Pass 1 walks the same FEFO-sorted `eligible` list but takes only whole cases per lot (skipping a lot too small to ever yield one, however early it expires); Pass 2 fills whatever's left as loose eaches, FEFO order, from any lot with quantity remaining — including a lot Pass 1 already partially used. A lot touched by both passes stays **one** `PickLine`, not two, so a picker is never sent to the same bin twice for one SKU.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/caseFirstAllocation.test.ts
import { describe, expect, it } from "vitest";
import { allocate } from "../../src/lib/engine";
import type { StockRow } from "../../src/lib/types";

const TODAY = new Date("2026-09-17");

function lot(rid: number, bin: string, batch: string, exp: [number, number], qty: number, expDate?: string): StockRow {
  return {
    rid, location: "SL Mother Hub", bin, sku: "SKU-CASE", name: "Product", batch,
    exp, expDate, qty, shelf: 24, type: "Good", active: "Active",
  };
}

const noReserve = () => 0;

describe("allocate() — caseSize omitted or <=1 behaves exactly as plain FEFO", () => {
  it("caseSize omitted: identical to today's single-pass behavior", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50)];
    const r = allocate({ sku: "SKU-CASE", need: 30, cutoff: 0, stock, reservedFor: noReserve, today: TODAY });
    expect(r.lines).toEqual([
      { rid: 1, sku: "SKU-CASE", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", vendorBatch: undefined, exp: [2027, 1], rem: expect.any(Number), qty: 30 },
    ]);
    expect(r.short).toBe(0);
  });

  it("caseSize of 1: identical to today's single-pass behavior", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50)];
    const r = allocate({ sku: "SKU-CASE", need: 30, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 1 });
    expect(r.lines[0].qty).toBe(30);
    expect(r.lines[0].caseQty).toBeUndefined();
    expect(r.lines[0].eachQty).toBeUndefined();
  });
});

describe("allocate() — case-first, real worked examples from the approved simulation", () => {
  it("basic split: 200 demand, case size 30 -> 6 cases + 20 eaches from one lot", () => {
    // The exact example from the design discussion: 200 units, case 30 -> 6*30=180 + 20 eaches.
    const stock = [lot(1, "A1", "B1", [2027, 1], 500)];
    const r = allocate({ sku: "SKU-CASE", need: 200, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 30 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(180);
    expect(r.lines[0].eachQty).toBe(20);
    expect(r.lines[0].qty).toBe(200);
    expect(r.short).toBe(0);
  });

  it("shelf-level example: 190 units, case size 20 -> 9 cases (180) + 10 eaches, all from that one lot", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 190)];
    const r = allocate({ sku: "SKU-CASE", need: 190, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(180);
    expect(r.lines[0].eachQty).toBe(10);
  });

  it("real production case: fragmented small bins get skipped for a single bin big enough to yield a whole case, even though it expires far later", () => {
    // MWBWSKP.00206.B0_N, MP Kolkata, Aug 25 2026, case size 300, need 300 —
    // real incident from the approved simulation. Earliest lots (Mar/Apr
    // 2029) are all too small individually to form one case; the first lot
    // big enough is Feb 2030 — 10 months later.
    const stock: StockRow[] = [
      lot(1, "A1", "MAR29", [2029, 3], 74, "2029-03-15"),
      lot(2, "A2", "APR29-1", [2029, 4], 10, "2029-04-01"),
      lot(3, "A3", "APR29-2", [2029, 4], 24, "2029-04-02"),
      lot(4, "A4", "APR29-3", [2029, 4], 254, "2029-04-03"),
      lot(5, "A5", "APR29-4", [2029, 4], 7, "2029-04-04"),
      lot(6, "A6", "APR29-5", [2029, 4], 2, "2029-04-05"),
      lot(7, "A7", "APR29-6", [2029, 4], 13, "2029-04-06"),
      lot(8, "A8", "APR29-7", [2029, 4], 80, "2029-04-07"),
      lot(9, "A9", "APR29-8", [2029, 4], 12, "2029-04-08"),
      lot(10, "A10", "APR29-9", [2029, 4], 11, "2029-04-09"),
      lot(11, "R13-C11-001", "FEB30", [2030, 2], 520, "2030-02-01"),
    ];
    const r = allocate({ sku: "SKU-CASE", need: 300, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 300 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].bin).toBe("R13-C11-001");
    expect(r.lines[0].caseQty).toBe(300);
    expect(r.lines[0].eachQty).toBeUndefined();
    expect(r.short).toBe(0);
  });

  it("Pass 2 falls back to loose eaches, FEFO order, including a lot Pass 1 skipped entirely", () => {
    // Case size 100. Lot A (earliest) has 40 units — too small for a case,
    // Pass 1 skips it entirely. Lot B (next) has 250 -> 2 cases (200) + 50
    // eaches available. Need 220: Pass 1 takes 2 cases (200) from Lot B,
    // Pass 2 needs 20 more -> takes it from Lot A (earliest remaining eaches).
    const stock = [
      lot(1, "A1", "EARLY", [2027, 1], 40, "2027-01-15"),
      lot(2, "A2", "LATE", [2027, 6], 250, "2027-06-15"),
    ];
    const r = allocate({ sku: "SKU-CASE", need: 220, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 100 });
    expect(r.lines).toHaveLength(2);
    const early = r.lines.find((l) => l.bin === "A1")!;
    const late = r.lines.find((l) => l.bin === "A2")!;
    expect(early.caseQty).toBeUndefined();
    expect(early.eachQty).toBe(20);
    expect(late.caseQty).toBe(200);
    expect(late.eachQty).toBeUndefined();
    expect(r.short).toBe(0);
  });

  it("one lot contributing to BOTH passes stays a single PickLine, not two", () => {
    // Case size 20. Lot has 45 units: Pass 1 takes 2 cases (40), leaving 5.
    // Need is 45, so Pass 2 needs 5 more, which is still sitting in this
    // exact same lot. Must merge into one line (40 case + 5 each = 45 qty),
    // not appear twice in r.lines.
    const stock = [lot(1, "A1", "B1", [2027, 1], 45, "2027-01-15")];
    const r = allocate({ sku: "SKU-CASE", need: 45, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(40);
    expect(r.lines[0].eachQty).toBe(5);
    expect(r.lines[0].qty).toBe(45);
  });

  it("short: case supply plus each supply together still can't cover demand", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50, "2027-01-15")]; // caseSize 20 -> 2 cases (40) + 10 eaches available = 50 max
    const r = allocate({ sku: "SKU-CASE", need: 70, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines[0].caseQty).toBe(40);
    expect(r.lines[0].eachQty).toBe(10);
    expect(r.short).toBe(20);
  });

  it("respects the shelf-life cutoff exactly as before — case-based picking never makes an ineligible lot pickable", () => {
    // Lot is 8 months out; cutoff requires 12. Must be excluded entirely,
    // same as plain FEFO would exclude it, regardless of case size.
    const stock = [lot(1, "A1", "B1", [2027, 5], 500, "2027-05-15")]; // ~8 months from TODAY (2026-09-17)
    const r = allocate({ sku: "SKU-CASE", need: 100, cutoff: 12, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(0);
    expect(r.short).toBe(100);
  });

  it("respects minQty (channel's minimum bin quantity floor) exactly as before", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 15, "2027-01-15")]; // below a 20-unit floor
    const r = allocate({ sku: "SKU-CASE", need: 15, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 5, minQty: 20 });
    expect(r.lines).toHaveLength(0);
    expect(r.short).toBe(15);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].bin).toBe("A1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/caseFirstAllocation.test.ts`
Expected: FAIL — `caseSize` isn't a recognized field on `AllocateArgs` yet (TS error) and `allocate()` ignores it, so every case-first test returns a single-pass FEFO result with no `caseQty`/`eachQty`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/engine.ts`, add `caseSize` to `AllocateArgs` (after `minQty`):

```ts
  // Minimum available qty a bin+batch must have to be offered at all — see
  // ChannelRule.minBinQty. Lots that clear the shelf-life cutoff but fall
  // under this floor are reported in `skipped` instead of being allocated.
  minQty?: number;
  // Case pack size for this SKU, if one is configured (see the case_sizes
  // table / caseSizesSupabase.ts). When set and > 1, allocation runs
  // case-first: full cases only (FEFO order, one case only ever from a
  // single bin — a picker can't assemble one case from four shelf
  // locations), then loose eaches for whatever remains. Omitted or <= 1
  // behaves exactly as before: plain per-unit FEFO, no case/each split.
  caseSize?: number;
```

Replace the tail of `allocate()` (from `let remain = need;` to the end) with:

```ts
  if (args.caseSize && args.caseSize > 1) {
    return allocateCaseFirst(sku, need, eligible, args.caseSize, skipped);
  }

  let remain = need;
  const lines: PickLine[] = [];
  for (const o of eligible) {
    if (remain <= 0) break;
    const take = Math.min(remain, o.av);
    lines.push({
      rid: o.b.rid,
      sku,
      name: o.b.name,
      facility: o.b.location,
      bin: o.b.bin,
      batch: o.b.batch,
      vendorBatch: o.b.vendorBatch,
      exp: o.b.exp,
      rem: o.rem,
      qty: take,
    });
    remain -= take;
  }
  return { lines, short: remain, any: eligible.length > 0, skipped };
}

/**
 * Case-first-then-eaches allocation: Pass 1 pulls only full cases, FEFO
 * order, one case only ever from a single bin+batch (a picker can't
 * assemble one case from four shelf locations — confirmed design
 * assumption). Pass 2 fills whatever remains as loose eaches, FEFO order,
 * from any lot with quantity left over, including a lot Pass 1 already
 * partially used. A lot touched by both passes stays ONE PickLine with a
 * caseQty+eachQty split, not two — a picker is never sent to the same bin
 * twice for one SKU.
 */
function allocateCaseFirst(
  sku: string,
  need: number,
  eligible: { rem: number; b: StockRow; av: number }[],
  caseSize: number,
  skipped: BinSkip[],
): AllocateResult {
  type Row = { o: (typeof eligible)[number]; caseQty: number; eachQty: number; remaining: number };
  const perLot = new Map<number, Row>();
  let remain = need;

  for (const o of eligible) {
    if (remain <= 0) break;
    const casesAvail = Math.floor(o.av / caseSize);
    const take = Math.min(Math.floor(remain / caseSize), casesAvail) * caseSize;
    if (take <= 0) continue;
    perLot.set(o.b.rid, { o, caseQty: take, eachQty: 0, remaining: o.av - take });
    remain -= take;
  }

  if (remain > 0) {
    for (const o of eligible) {
      if (remain <= 0) break;
      const row = perLot.get(o.b.rid);
      const available = row ? row.remaining : o.av;
      const take = Math.min(remain, available);
      if (take <= 0) continue;
      if (row) {
        row.eachQty += take;
        row.remaining -= take;
      } else {
        perLot.set(o.b.rid, { o, caseQty: 0, eachQty: take, remaining: o.av - take });
      }
      remain -= take;
    }
  }

  const lines: PickLine[] = [...perLot.values()]
    .sort((a, b) => a.o.rem - b.o.rem || (a.o.b.expDate && b.o.b.expDate ? a.o.b.expDate.localeCompare(b.o.b.expDate) : 0))
    .map(({ o, caseQty, eachQty }) => ({
      rid: o.b.rid,
      sku,
      name: o.b.name,
      facility: o.b.location,
      bin: o.b.bin,
      batch: o.b.batch,
      vendorBatch: o.b.vendorBatch,
      exp: o.b.exp,
      rem: o.rem,
      qty: caseQty + eachQty,
      caseQty: caseQty > 0 ? caseQty : undefined,
      eachQty: eachQty > 0 ? eachQty : undefined,
    }));

  return { lines, short: remain, any: eligible.length > 0, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/caseFirstAllocation.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — every existing caller of `allocate()` omits `caseSize`, so nothing else changes behavior.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine.ts tests/engine/caseFirstAllocation.test.ts
git commit -m "feat: case-first-then-eaches allocation in engine.ts, gated on an optional caseSize"
```

---

### Task 3: `case_sizes` Supabase table + sync module

**Files:**
- Create: `supabase/add_case_sizes_table.sql`
- Create: `src/lib/caseSizesSupabase.ts`
- Test: `tests/lib/caseSizesSupabase.test.ts`

Mirrors `channel_overrides`/`channelsSupabase.ts` exactly — same shape, same realtime pattern, same access model (Admin/Super Admin write, everyone read).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/caseSizesSupabase.test.ts
import { describe, expect, it } from "vitest";
import { applyCaseSizeRows } from "../../src/lib/caseSizesSupabase";

describe("applyCaseSizeRows", () => {
  it("builds a sku -> case size map from rows", () => {
    const result = applyCaseSizeRows([
      { sku: "SKU-A", case_size: 30 },
      { sku: "SKU-B", case_size: 190 },
    ]);
    expect(result).toEqual({ "SKU-A": 30, "SKU-B": 190 });
  });

  it("a SKU with no row simply has no entry — not a 0 or a default", () => {
    const result = applyCaseSizeRows([{ sku: "SKU-A", case_size: 30 }]);
    expect(result["SKU-UNKNOWN"]).toBeUndefined();
  });

  it("ignores a case_size of 0 or 1 as effectively 'not set'", () => {
    const result = applyCaseSizeRows([
      { sku: "SKU-A", case_size: 0 },
      { sku: "SKU-B", case_size: 1 },
      { sku: "SKU-C", case_size: 12 },
    ]);
    expect(result).toEqual({ "SKU-C": 12 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/caseSizesSupabase.test.ts`
Expected: FAIL — `src/lib/caseSizesSupabase.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```sql
-- supabase/add_case_sizes_table.sql
--
-- FEFO Smart Picking — case pack sizes (Phase 1 of case-based picking).
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.
--
-- One row per SKU that has a known case pack size. A SKU with no row here
-- behaves exactly as today (plain per-unit FEFO, no case/each split) — see
-- allocate() in engine.ts. Same shared-table + Realtime pattern as
-- channel_overrides (add_channel_overrides_table.sql), so an Admin edit
-- reaches every browser live instead of being stuck in local storage.

create table if not exists case_sizes (
  sku        text primary key,
  case_size  integer not null check (case_size > 1),
  updated_at timestamptz not null default now()
);

alter table case_sizes enable row level security;

create policy "read case sizes" on case_sizes for select to authenticated using (true);

-- Only Admin/Super Admin can add, edit, or remove a case size — same access
-- model as channel dispatch tolerance.
create policy "admin manage case sizes" on case_sizes for all to authenticated
  using (current_role_name() in ('admin', 'super_admin'))
  with check (current_role_name() in ('admin', 'super_admin'));

alter publication supabase_realtime add table case_sizes;
```

```ts
// src/lib/caseSizesSupabase.ts
import { supabase } from "./supabaseClient";

export interface CaseSizeRow {
  sku: string;
  case_size: number;
}

/**
 * Builds a plain sku -> case size lookup from the raw rows. A case_size of
 * 0 or 1 is treated as "not set" (nothing meaningful to show/allocate as a
 * case) — same convention as everywhere else in this feature. Pure/testable
 * without a live Supabase connection, same shape as applyChannelOverrides.
 */
export function applyCaseSizeRows(rows: CaseSizeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.case_size > 1) out[r.sku] = r.case_size;
  }
  return out;
}

export async function fetchCaseSizes(): Promise<CaseSizeRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("case_sizes").select("sku,case_size");
  if (error) throw error;
  return (data ?? []) as CaseSizeRow[];
}

export async function upsertCaseSize(sku: string, caseSize: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("case_sizes").upsert({ sku, case_size: caseSize }, { onConflict: "sku" });
  if (error) throw error;
}

export async function deleteCaseSize(sku: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("case_sizes").delete().eq("sku", sku);
  if (error) throw error;
}

/** Refetch-on-any-change — same pattern as subscribeChannelOverrides/subscribePickers. */
export function subscribeCaseSizes(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("case-sizes-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "case_sizes" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/caseSizesSupabase.test.ts`
Expected: PASS

- [ ] **Step 5: Run the migration against Supabase**

Run `supabase/add_case_sizes_table.sql` in Supabase → SQL Editor, then confirm:
```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;
```
Expected: the list includes `case_sizes`.

- [ ] **Step 6: Commit**

```bash
git add supabase/add_case_sizes_table.sql src/lib/caseSizesSupabase.ts tests/lib/caseSizesSupabase.test.ts
git commit -m "feat: add case_sizes table and sync module"
```

---

### Task 4: Wire `caseSizes` into the store

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/App.tsx`
- Test: `tests/demand/caseSizesInAllocation.test.ts`

Loads and live-syncs `caseSizes` the same way `channelRules` already is, then threads it through `allocateAcrossFacilities` → `computeChannelAllocations` (initial `generate()`) and into `applyPicks`'s not-found round-2+ re-offer path, so a re-offer also gets case-first treatment for a SKU that has one configured.

- [ ] **Step 1: Write the failing test**

```ts
// tests/demand/caseSizesInAllocation.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — respects caseSizes when allocating", () => {
  it("produces a case+each split when the SKU has a configured case size", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-CS", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-CS": { name: "Product", shelf: 24 } },
      caseSizes: { "SKU-CS": 30 },
      tasks: [],
    });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-CS", qty: 200, gatePassNo: "GP-CS-1" }]);

    await useStore.getState().generate(null, "Tester");

    const task = useStore.getState().tasks.find((t) => t.channel === CHANNEL)!;
    const line = task.facilities[0].lines[0];
    expect(line.caseQty).toBe(180);
    expect(line.eachQty).toBe(20);
    expect(line.qty).toBe(200);
  });

  it("a SKU with no configured case size still allocates plain FEFO, unchanged", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-NOCASE", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-NOCASE": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-CS": 30 }, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-NOCASE", qty: 200, gatePassNo: "GP-CS-2" }]);

    await useStore.getState().generate(null, "Tester");

    const task = useStore.getState().tasks.find((t) => t.channel === CHANNEL)!;
    const line = task.facilities[0].lines[0];
    expect(line.qty).toBe(200);
    expect(line.caseQty).toBeUndefined();
    expect(line.eachQty).toBeUndefined();
  });
});

describe("applyPicks — round-2 re-offer also respects caseSizes", () => {
  it("a not-found re-offer for a SKU with a configured case size gets its own case+each split", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-CS-R2", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-CS-R2",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-CS-R2", qty: 200, gatePassNo: "GP-CS-R2" }],
      facilities: [
        {
          no: "TASK-CS-R2-MH", taskNo: "TASK-CS-R2", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-CS-R2",
          lines: [{ rid: 99, sku: "SKU-CS-R2", name: "Product", facility: "SL Mother Hub", bin: "Z1", batch: "OLD", exp: [2099, 1], rem: 900, qty: 200 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock, skus: { "SKU-CS-R2": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-CS-R2": 30 }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-CS-R2-MH", { 99: 200 }, { 99: "Batch mismatch" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-CS-R2")!;
    const round2 = updated.facilities.find((f) => f.round === 2)!;
    expect(round2.lines[0].caseQty).toBe(180);
    expect(round2.lines[0].eachQty).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/demand/caseSizesInAllocation.test.ts`
Expected: FAIL — `caseSizes` isn't a recognized state field, `generate()`/`applyPicks` never pass a `caseSize` through, so every line comes back with no `caseQty`/`eachQty`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`:

Add the import (alongside the existing `channelsSupabase` import):
```ts
import { applyCaseSizeRows, fetchCaseSizes, subscribeCaseSizes } from "./caseSizesSupabase";
```

Add to `AppState` (near `channelRules`, `loadChannelOverrides`, `startChannelOverridesRealtime`):
```ts
  caseSizes: Record<string, number>;
  loadCaseSizes: () => Promise<void>;
  startCaseSizesRealtime: () => () => void;
```

Add to the initial state (near `channelRules: { ...CHANNELS },`):
```ts
      caseSizes: {},
```

Add the actions (near `loadChannelOverrides`/`startChannelOverridesRealtime`):
```ts
      loadCaseSizes: async () => {
        if (!isSupabaseConfigured) return;
        try {
          const rows = await fetchCaseSizes();
          set({ caseSizes: applyCaseSizeRows(rows) });
        } catch {
          // Transient failure — keep whatever's already in state.
        }
      },

      startCaseSizesRealtime: () => {
        if (!isSupabaseConfigured) return () => {};
        return subscribeCaseSizes(() => void get().loadCaseSizes());
      },
```

Thread `caseSize` through `allocateAcrossFacilities` (add a parameter, pass it to `allocate`):
```ts
function allocateAcrossFacilities(
  sku: string,
  need: number,
  cutoff: number,
  stock: StockRow[],
  reserved: (key: string) => number,
  exclude: number[],
  heldKeys: Set<string>,
  minQty?: number,
  caseSize?: number,
): { byFacility: Record<string, PickLine[]>; short: number; skipped: BinSkip[] } {
  const r = allocate({ sku, need, cutoff, stock, reservedFor: reserved, exclude, heldKeys, minQty, caseSize });
  const byFacility: Record<string, PickLine[]> = {};
  for (const line of r.lines) (byFacility[line.facility] ??= []).push(line);
  return { byFacility, short: r.short, skipped: r.skipped };
}
```

Thread it through `computeChannelAllocations` — add a `caseSizes` parameter (default `{}` so existing callers that don't pass it keep working unchanged) and pass the per-SKU lookup into its own `allocateAcrossFacilities` call:
```ts
export function computeChannelAllocations(
  demand: DemandLine[],
  channelRules: Record<string, ChannelRule>,
  skus: Record<string, SkuInfo>,
  stock: StockRow[],
  existingTasks: PickingTask[],
  heldKeys: Set<string> = new Set(),
  caseSizes: Record<string, number> = {},
): ChannelAllocation[] {
```
and inside its per-line loop, change:
```ts
      const w = allocateAcrossFacilities(d.sku, d.qty, cutoff, stock, reserved, [], heldKeys, rule.minBinQty);
```
to:
```ts
      const w = allocateAcrossFacilities(d.sku, d.qty, cutoff, stock, reserved, [], heldKeys, rule.minBinQty, caseSizes[d.sku]);
```

Update `generate()`'s own call (around line 1021) to pass `get().caseSizes`:
```ts
        const allocations = computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks), activeHoldKeys(get().holds), get().caseSizes);
```

Update the not-found round-2+ re-offer's own `allocateAcrossFacilities` call inside `applyPicks` (the one inside the `for (const sku of Object.keys(nfBySku))` loop) to pass the case size for that SKU:
```ts
            const w = allocateAcrossFacilities(sku, nfBySku[sku], cutoff, stock, reserved, heldKeysForRound2, rule.minBinQty, state.caseSizes[sku]);
```
(Match this against whatever the current exact parameter list is at that call site when you get to it — Task 15 of the separate architecture-review-fixes plan, if already merged, changes this same line's shape; use whichever form is actually present in the file, just add `state.caseSizes[sku]` as the new trailing argument.)

Also update the `partialize` function (search for where it lists which state survives a page reload) — `caseSizes` should be treated exactly like `channelRules`: not persisted to localStorage when Supabase is configured, since it's always live-loaded fresh (same reasoning as the existing comment there).

In `src/App.tsx`, add `loadCaseSizes`/`startCaseSizesRealtime` to the mount effect exactly the way `loadChannelOverrides`/`startChannelOverridesRealtime` are already wired (destructure from the store, call `loadCaseSizes()` alongside the other loads, start the realtime subscription alongside the others, stop it in the cleanup).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/demand/caseSizesInAllocation.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — every other existing caller of `computeChannelAllocations`/`allocateAcrossFacilities` (including `DemandPanel.tsx`'s preview call) omits the new trailing argument, which defaults to `{}`/`undefined`, so nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts src/App.tsx tests/demand/caseSizesInAllocation.test.ts
git commit -m "feat: wire caseSizes into generate() and the not-found round-2+ re-offer path"
```

---

### Task 5: Demand Planner preview also respects case sizes

**Files:**
- Modify: `src/components/DemandPanel.tsx`

The "review allocation" preview step must show the same case/each split the real `generate()` call will produce — otherwise what a Planner previews and what actually gets created disagree (breaking the guarantee already documented at `computeChannelAllocations`'s own doc comment: "preview and generate can never disagree").

- [ ] **Step 1: Make the change**

In `src/components/DemandPanel.tsx`, find the existing call (around line 92):
```ts
    return computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks));
```
Add the store's `caseSizes` (read it the same way `channelRules`/`skus`/`stock`/`tasks` are already read in this component) and pass it as the trailing argument:
```ts
    return computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks), activeHoldKeys(holds), caseSizes);
```
(Match whatever the actual current 6th argument is — this file may already pass `heldKeys`/`activeHoldKeys(holds)` there; if not, check what `generate()` passes and keep preview consistent with it, adding `caseSizes` as the true trailing argument either way.)

- [ ] **Step 2: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DemandPanel.tsx
git commit -m "fix: Demand Planner preview uses caseSizes so it matches what generate() will actually create"
```

---

### Task 6: Supervisor display — show the case+each split

**Files:**
- Modify: `src/components/FacilityBlock.tsx`
- Test: `tests/components/FacilityBlockCaseDisplay.test.tsx`

A SKU with no case size shows exactly as today. A line with `caseQty`/`eachQty` set shows e.g. "6 cases + 20 eaches" instead of a flat "200".

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/FacilityBlockCaseDisplay.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FacilityBlock } from "../../src/components/FacilityBlock";
import { useAuth } from "../../src/lib/authStore";
import type { FacilityPicklist } from "../../src/lib/types";

function facility(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "TASK-DISP-MH", taskNo: "TASK-DISP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
    lines: [],
    ...overrides,
  };
}

describe("FacilityBlock — case+each display", () => {
  it("shows a case/each breakdown when the line has one", () => {
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "admin" } });
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200, caseQty: 180, eachQty: 20 }],
    });
    render(<FacilityBlock f={f} taskNo="TASK-DISP" />);
    expect(screen.getByText(/180 cases/)).toBeInTheDocument();
    expect(screen.getByText(/20 eaches/)).toBeInTheDocument();
  });

  it("a line with no case size shows the plain quantity, unchanged", () => {
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "admin" } });
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-PLAIN", name: "Product Plain", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200 }],
    });
    render(<FacilityBlock f={f} taskNo="TASK-DISP" />);
    expect(screen.queryByText(/cases/)).not.toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("a line that is ALL cases (no loose remainder) shows only the case quantity, not '0 eaches'", () => {
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "admin" } });
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-ALLCASE", name: "Product AllCase", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 300, caseQty: 300 }],
    });
    render(<FacilityBlock f={f} taskNo="TASK-DISP" />);
    expect(screen.getByText(/300 cases/)).toBeInTheDocument();
    expect(screen.queryByText(/eaches/)).not.toBeInTheDocument();
  });
});
```

Note: check `FacilityBlock`'s actual current prop signature before writing this test (it may take different/additional required props than shown above — match whatever's real) — the test's job is to render one facility with case-split lines and assert the text appears; adapt the render call to the component's real props.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/FacilityBlockCaseDisplay.test.tsx`
Expected: FAIL — the component doesn't know about `caseQty`/`eachQty` yet, so it renders the flat `qty`/`picked` number for every line.

- [ ] **Step 3: Write minimal implementation**

In `src/components/FacilityBlock.tsx`, add a small formatter near the top of the file (or alongside other line-display helpers already in the file). Note this is deliberately phrased as **quantities** ("180 cases + 20 eaches"), not a case **count** ("6 cases") — `PickLine` only carries the resulting `caseQty`/`eachQty`, not the case size itself, so a true case count isn't available to the display layer without extra data it doesn't have:

```tsx
/** "180 cases + 20 eaches" style label for a case-split line; undefined for a plain line (caller falls back to the flat qty). Deliberately phrased as quantities, not a case COUNT, since PickLine only carries the resulting caseQty/eachQty, not the case size itself. */
function caseEachLabel(l: { caseQty?: number; eachQty?: number }): string | undefined {
  if (!l.caseQty && !l.eachQty) return undefined;
  const parts: string[] = [];
  if (l.caseQty) parts.push(`${l.caseQty} case${l.caseQty === 1 ? "" : "s"}`);
  if (l.eachQty) parts.push(`${l.eachQty} each${l.eachQty === 1 ? "" : "es"}`);
  return parts.join(" + ");
}
```

Then find the existing render of `{open ? l.qty : (l.picked ?? l.qty)}` (around line 176) and replace it with:
```tsx
{caseEachLabel(l) ?? (open ? l.qty : (l.picked ?? l.qty))}
```

(Case/each display only makes sense for the still-open suggested quantity, not a completed/picked count — `l.picked` after completion has no case/each split of its own, since the picker just confirms a total. Keep the fallback to `l.picked ?? l.qty` exactly as it is today for the completed state; only the open-state branch gets the new label.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/FacilityBlockCaseDisplay.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no existing `FacilityBlock` test uses `caseQty`/`eachQty`, so none of them hit the new branch.

- [ ] **Step 6: Commit**

```bash
git add src/components/FacilityBlock.tsx tests/components/FacilityBlockCaseDisplay.test.tsx
git commit -m "feat: Supervisor screen shows case+each breakdown when a line has one"
```

---

### Task 7: Picker display — show the case+each split

**Files:**
- Modify: `src/components/PickerView.tsx`
- Test: `tests/picker/pickerCaseDisplay.test.tsx`

The picker's big "Pick {qty}" instruction becomes "Pick 6 cases + 20 eaches" when the line has a split, otherwise unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/picker/pickerCaseDisplay.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PickerView } from "../../src/components/PickerView";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();
afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function taskWithCaseSplitLine(): PickingTask {
  return {
    no: "TASK-PVCASE",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      {
        no: "TASK-PVCASE-MH", taskNo: "TASK-PVCASE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GPSLMH11300",
        lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 200, caseQty: 180, eachQty: 20, picker: "Ravi" }],
      },
    ],
  };
}

describe("PickerView — case+each display", () => {
  it("shows the case+each breakdown in the Pick instruction", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "ravi@example.com", display_name: "Ravi", role: "picker" } });
    useStore.setState({ tasks: [taskWithCaseSplitLine()] });
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    expect(screen.getByText(/180 cases/)).toBeInTheDocument();
    expect(screen.getByText(/20 eaches/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picker/pickerCaseDisplay.test.tsx`
Expected: FAIL — the "Pick {line.qty}" div only ever shows the flat number.

- [ ] **Step 3: Write minimal implementation**

In `src/components/PickerView.tsx`, add the same small formatter as Task 6 (or, better, extract it once into a shared location both components import — e.g. `src/lib/format.ts`, which other display helpers in this codebase already live in; check that file first and add it there if so, importing it into both `FacilityBlock.tsx` and `PickerView.tsx` instead of duplicating it):

```ts
// src/lib/format.ts — add alongside existing formatters
/** "180 cases + 20 eaches" style label for a case-split pick line; undefined for a plain line. */
export function caseEachLabel(l: { caseQty?: number; eachQty?: number }): string | undefined {
  if (!l.caseQty && !l.eachQty) return undefined;
  const parts: string[] = [];
  if (l.caseQty) parts.push(`${l.caseQty} case${l.caseQty === 1 ? "" : "s"}`);
  if (l.eachQty) parts.push(`${l.eachQty} each${l.eachQty === 1 ? "" : "es"}`);
  return parts.join(" + ");
}
```

(If this shared-location refactor is taken, go back and update Task 6's `FacilityBlock.tsx` change to import `caseEachLabel` from `./format` instead of defining its own local copy — do this as part of finishing this task, not as a separate one, so there's never a moment with two diverging copies of the same function in the tree.)

Then in `PickerView.tsx`, find the existing line (around line 157):
```tsx
<div className="mt-3 inline-block rounded-lg bg-slate-100 px-4 py-2 text-2xl font-bold tabular-nums dark:bg-slate-900">Pick {line.qty}</div>
```
Replace with:
```tsx
<div className="mt-3 inline-block rounded-lg bg-slate-100 px-4 py-2 text-2xl font-bold tabular-nums dark:bg-slate-900">Pick {caseEachLabel(line) ?? line.qty}</div>
```

Leave every other `line.qty` reference in this file untouched (the not-found quantity stepper, the "Found — Picked {qty}" button, etc. all still operate in plain units — only the headline instruction needs the case/each phrasing, since the not-found flow reports a shortfall in units regardless of how it was meant to be picked).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picker/pickerCaseDisplay.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/components/PickerView.tsx src/components/FacilityBlock.tsx tests/picker/pickerCaseDisplay.test.tsx
git commit -m "feat: Picker screen shows case+each breakdown in the Pick instruction"
```

---

### Task 8: Admin screen to manage case sizes

**Files:**
- Modify: `src/components/AdminConfig.tsx`
- Test: `tests/admin/caseSizesAdmin.test.tsx`

Mirrors the existing Channel Dispatch Tolerance card's add/edit/delete UI in the same screen — read that section of `AdminConfig.tsx` first (search for where channel rules are edited) and copy its shape (a small form to add/update one SKU's case size, a list of existing entries with an edit/remove action per row) rather than inventing a different UI pattern for a very similar job.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/admin/caseSizesAdmin.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminConfig } from "../../src/components/AdminConfig";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";

vi.mock("../../src/lib/caseSizesSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/caseSizesSupabase")>();
  return { ...actual, upsertCaseSize: vi.fn(async () => undefined), deleteCaseSize: vi.fn(async () => undefined) };
});

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();
afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
  vi.resetModules();
});

describe("AdminConfig — case sizes", () => {
  it("lists existing case sizes and lets an admin add a new one", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({ caseSizes: { "SKU-EXISTING": 40 } });
    render(<AdminConfig />);

    expect(screen.getByText("SKU-EXISTING")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();

    const skuInput = screen.getByLabelText(/sku/i, { selector: "input" });
    const sizeInput = screen.getByLabelText(/case size/i);
    await user.type(skuInput, "SKU-NEW");
    await user.type(sizeInput, "25");
    await user.click(screen.getByRole("button", { name: /add case size|save/i }));

    const caseSizesSupabase = await import("../../src/lib/caseSizesSupabase");
    expect(caseSizesSupabase.upsertCaseSize).toHaveBeenCalledWith("SKU-NEW", 25);
  });
});
```

Note: check `AdminConfig.tsx`'s actual current structure (how it's rendered/what wrapping it needs, exact label text used by the analogous channel-rule form) before finalizing selectors here — adapt them to match what's real rather than what's guessed above; the test's job is to prove an admin can see existing case sizes and add a new one that reaches `upsertCaseSize`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin/caseSizesAdmin.test.tsx`
Expected: FAIL — no case-size UI exists yet.

- [ ] **Step 3: Write minimal implementation**

Add a new card to `AdminConfig.tsx`, following the exact structure of the existing Channel Dispatch Tolerance card in the same file (same card/heading/table conventions, same `Admin`/`Super Admin`-only gating already used elsewhere on this screen):
- A small add/edit form: SKU text input, case size number input, Save button — calls `upsertCaseSize(sku, caseSize)` from `caseSizesSupabase.ts`, then relies on the existing realtime subscription (Task 4) to refresh `caseSizes` in the store rather than manually updating local state.
- A list of current `caseSizes` entries (from the store), each with a Remove action calling `deleteCaseSize(sku)`.
- Basic validation: reject an empty SKU, reject a case size ≤ 1 (mirrors the database check constraint from Task 3, so a bad entry is caught before the round-trip rather than only after a Supabase error).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin/caseSizesAdmin.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/AdminConfig.tsx tests/admin/caseSizesAdmin.test.tsx
git commit -m "feat: Admin screen to manage case sizes per SKU"
```

---

### Task 9: Human-facing exports get a cases/eaches column (WMS export stays units-only)

**Files:**
- Modify: `src/components/FacilityBlock.tsx` (the `shareRows`/copy/CSV helper already found in Task 6's exploration, around lines 32-59)
- Test: `tests/components/FacilityBlockExportCaseColumn.test.ts`

Per the approved design: Print/Copy/CSV (human-facing) get a cases/eaches column; the Uniware-bound Bulk Gate Pass CSV (a strict import-contract file, unrelated component) is explicitly NOT touched — adding a column there risks breaking Uniware's importer.

- [ ] **Step 1: Write the failing test**

```ts
// tests/components/FacilityBlockExportCaseColumn.test.ts
import { describe, expect, it } from "vitest";
// Import whatever the actual exported/testable shareRows-building function
// is named in FacilityBlock.tsx once you've read it — this may need to be
// exported from the component file if it isn't already (a `export` keyword
// added to an existing local function is the minimal change, not a new file).
import { buildShareRows } from "../../src/components/FacilityBlock";
import type { FacilityPicklist } from "../../src/lib/types";

describe("FacilityBlock share/export rows — case+each column", () => {
  it("includes case and each columns for a split line", () => {
    const f: FacilityPicklist = {
      no: "TASK-EXP-MH", taskNo: "TASK-EXP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
      lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200, caseQty: 180, eachQty: 20 }],
    };
    const rows = buildShareRows(f);
    expect(rows[0]).toMatchObject({ qty: 200, caseQty: 180, eachQty: 20 });
  });

  it("a plain line (no case size) has empty/undefined case and each columns", () => {
    const f: FacilityPicklist = {
      no: "TASK-EXP-MH", taskNo: "TASK-EXP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
      lines: [{ rid: 1, sku: "SKU-PLAIN", name: "Product Plain", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200 }],
    };
    const rows = buildShareRows(f);
    expect(rows[0].caseQty).toBeUndefined();
    expect(rows[0].eachQty).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/FacilityBlockExportCaseColumn.test.ts`
Expected: FAIL — the current `shareRows` function (however it's actually named/scoped) doesn't include `caseQty`/`eachQty`, and likely isn't exported for direct testing yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/FacilityBlock.tsx`, find the row-building logic (around line 32: `qty: l.qty, picker: l.picker ?? "",`) and add `caseQty: l.caseQty, eachQty: l.eachQty,` to the same object. Export the function that builds these rows if it isn't already exported (add the `export` keyword — don't restructure it). Update the CSV header row and the HTML table header (around lines 38 and 59) to add "Cases" and "Eaches" columns alongside the existing ones, populated from the new fields (blank/empty string when undefined, not "0").

Do not touch the separate Bulk Gate Pass CSV component/export (a different, Uniware-import-contract file elsewhere in the codebase) — confirm you're editing the human-facing share/export path in `FacilityBlock.tsx`, not that one, before making this change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/FacilityBlockExportCaseColumn.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/FacilityBlock.tsx tests/components/FacilityBlockExportCaseColumn.test.ts
git commit -m "feat: add cases/eaches columns to the human-facing share/CSV export"
```

---

### Task 10: One-time backfill of real case sizes

**Files:**
- Reference data: `docs/superpowers/specs/2026-09-17-case-sizes-seed.csv` (already generated and verified this session — 276 SKUs, sourced from `Active SKU Config.xlsx`'s "Case Configuration" column, non-numeric/"NA" rows already excluded)
- No code changes — this is a one-time data load, not a feature.

- [ ] **Step 1: Confirm the case_sizes table exists** (Task 3's migration must already be applied)

Run in Supabase → SQL Editor:
```sql
select count(*) from case_sizes;
```
Expected: `0` (empty, pre-backfill) — if this errors, Task 3's migration hasn't been run yet; do that first.

- [ ] **Step 2: Load the seed CSV**

The CSV is small enough (276 rows) to paste directly as a bulk upsert. Generate the SQL from the CSV:

```bash
python3 -c "
import csv
with open('docs/superpowers/specs/2026-09-17-case-sizes-seed.csv') as f:
    rows = list(csv.DictReader(f))
print('insert into case_sizes (sku, case_size) values')
print(',\n'.join(f\"  ('{r['sku']}', {r['case_size']})\" for r in rows))
print('on conflict (sku) do update set case_size = excluded.case_size, updated_at = now();')
" > /tmp/case_sizes_seed.sql
```

Run the generated `/tmp/case_sizes_seed.sql` in Supabase → SQL Editor.

- [ ] **Step 3: Verify the backfill**

Run in Supabase → SQL Editor:
```sql
select count(*) from case_sizes;
```
Expected: `276`.

Spot-check the two worked examples referenced in Task 2's tests, since these are the real SKUs the whole approved simulation was calibrated against:
```sql
select sku, case_size from case_sizes where sku in ('MWBWSKP.00206.B0_N', 'MWMMHTP.0005.AAAA.B0_N');
```
Expected: `MWBWSKP.00206.B0_N` → `300`, `MWMMHTP.0005.AAAA.B0_N` → `190` (matching the numbers already reported to management — if either differs, stop and flag it, don't silently trust the seed file over what was already presented).

- [ ] **Step 4: Confirm it's live in the app**

Sign into the app, open Admin → the new case sizes card (Task 8) — 276 entries should already be listed, since the app loads `case_sizes` live from Supabase, not from this seed file.

No commit needed for this task (it's a data change, not a code change) — but note in the PR description or a follow-up message to Vipul that the backfill has run and the count that resulted.

---

## Explicitly out of scope (this phase)

- **Phase 2** (slotting/putaway fix, eaches-rationing simulation) — separate plan, comes after this one is live and stable, per the agreed sequencing with PD.
- **The Bulk Gate Pass CSV** (Uniware-bound WMS export) — deliberately untouched; stays units-only.
- **Auto-detecting case size from stock data** — case size is admin-entered/backfilled only in this phase, never inferred from bin quantities (that would silently produce wrong sizes whenever a bin happens to hold a non-case-multiple of stock for an unrelated reason).
