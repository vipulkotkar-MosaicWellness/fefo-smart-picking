# Stock Holds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a picker marks a line not-found, automatically lock that exact SKU+Facility+Bin+Batch combination out of every future allocation (fresh picklists and round-2 alternates) until an Admin/Super Admin/Planner releases it.

**Architecture:** A new `stock_holds` Supabase table is the source of truth. A pure `holdKey()` function turns a stock row's real-world identity into a string key; the core `allocate()` function (already the single place that filters out damaged stock and CC-NTF exception bins) gains one more filter against a `Set<string>` of active hold keys, so both `generate()` and the round-2 not-found waterfall respect holds automatically. `applyPicks()` auto-creates holds for any not-found line when a picklist completes. A new "Stock Holds" screen lets Admin/Super Admin/Planner release them.

**Tech Stack:** React + TypeScript + Zustand (persist middleware) + Supabase (Postgres, RLS) + Vitest + Tailwind — matches the rest of this codebase exactly, no new libraries.

**Spec:** `docs/stock-holds-design.md`

---

## Task 0: Database setup (you do this, not code)

**Files:** none — this runs in the Supabase SQL editor.

- [ ] **Step 1: Run this SQL once against the project's Supabase database**

```sql
create table stock_holds (
  id bigint generated always as identity primary key,
  sku text not null,
  facility text not null,
  bin text not null,
  batch text not null,
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

-- Only Admin/Super Admin/Planner may release a hold.
create policy "planner admin release holds" on stock_holds
  for update to authenticated
  using (current_role_name() in ('planner', 'admin', 'super_admin'))
  with check (current_role_name() in ('planner', 'admin', 'super_admin'));
```

This reuses the `current_role_name()` helper already defined in
`supabase/schema_step3_complete.sql`.

- [ ] **Step 2: Confirm the table exists**

In the Supabase Table Editor, confirm `stock_holds` appears with the 11 columns above and RLS is "Enabled".

Everything below this point is code and works locally without this table (holds will just fail to save/load, caught gracefully) — but the feature isn't real until this step is done.

---

## Task 1: Hold type + pure helpers

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/holds.ts`
- Test: `tests/holds/holds.test.ts`

- [ ] **Step 1: Add the `Hold` type**

In `src/lib/types.ts`, add at the end of the file:

```typescript
/** A SKU+Facility+Bin+Batch combination excluded from allocation until released. */
export interface Hold {
  id: number;
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  heldAt: string;
  heldBy: string;
  reason?: string;
  sourceTaskNo?: string;
  releasedAt?: string;
  releasedBy?: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/holds/holds.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { activeHoldKeys, holdKey, holdsToCreate } from "../../src/lib/holds";
import type { Hold } from "../../src/lib/types";

function hold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: 1,
    sku: "SKU-1",
    facility: "SL Mother Hub",
    bin: "A1",
    batch: "B1",
    heldAt: "2026-08-08T10:00:00.000Z",
    heldBy: "Admin",
    ...overrides,
  };
}

describe("holdKey", () => {
  it("combines sku, facility, bin, and batch into one string", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).toBe("SKU-1::SL Mother Hub::A1::B1");
  });

  it("produces different keys for different batches of the same sku+bin", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).not.toBe(holdKey("SKU-1", "SL Mother Hub", "A1", "B2"));
  });
});

describe("activeHoldKeys", () => {
  it("includes a hold with no releasedAt", () => {
    const keys = activeHoldKeys([hold()]);
    expect(keys.has(holdKey("SKU-1", "SL Mother Hub", "A1", "B1"))).toBe(true);
  });

  it("excludes a hold that has been released", () => {
    const keys = activeHoldKeys([hold({ releasedAt: "2026-08-09T10:00:00.000Z", releasedBy: "Admin" })]);
    expect(keys.size).toBe(0);
  });
});

describe("holdsToCreate", () => {
  it("creates one hold request per not-found line", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 4, nfReason: "Damaged stock" }];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toEqual([{ sku: "SKU-1", facility: "SL Mother Hub", bin: "A1", batch: "B1", reason: "Damaged stock", sourceTaskNo: "PT-001" }]);
  });

  it("skips a line with no not-found quantity", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 0 }];
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set())).toEqual([]);
  });

  it("skips a combination that's already actively held", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 }];
    const existing = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", existing)).toEqual([]);
  });

  it("de-duplicates two not-found lines that share the same sku+bin+batch", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 3 },
    ];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toHaveLength(1);
  });

  it("keeps two different skus on the same bin as two separate hold requests", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-2", bin: "A1", batch: "B9", nf: 5 },
    ];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/holds/holds.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/lib/holds"`

- [ ] **Step 4: Implement `src/lib/holds.ts`**

```typescript
import type { Hold } from "./types";

/** A stock lot's real-world identity — stable across stock re-syncs, unlike its internal rid. */
export function holdKey(sku: string, facility: string, bin: string, batch: string): string {
  return `${sku}::${facility}::${bin}::${batch}`;
}

/** Keys for every hold not yet released — what allocate() checks against. */
export function activeHoldKeys(holds: Hold[]): Set<string> {
  return new Set(holds.filter((h) => !h.releasedAt).map((h) => holdKey(h.sku, h.facility, h.bin, h.batch)));
}

export interface NewHoldRequest {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  reason?: string;
  sourceTaskNo: string;
}

/**
 * Which not-found lines from a just-completed facility picklist need a new
 * hold — one per distinct SKU+Bin+Batch, skipping anything already actively
 * held so a repeat completion doesn't create duplicate rows.
 */
export function holdsToCreate(
  lines: { sku: string; bin: string; batch: string; nf?: number; nfReason?: string }[],
  facility: string,
  sourceTaskNo: string,
  existingActiveKeys: Set<string>,
): NewHoldRequest[] {
  const seen = new Set<string>();
  const out: NewHoldRequest[] = [];
  for (const l of lines) {
    if (!l.nf || l.nf <= 0) continue;
    const key = holdKey(l.sku, facility, l.bin, l.batch);
    if (existingActiveKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ sku: l.sku, facility, bin: l.bin, batch: l.batch, reason: l.nfReason, sourceTaskNo });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/holds/holds.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/holds.ts tests/holds/holds.test.ts
git commit -m "feat: add Hold type and pure hold-key helpers"
```

---

## Task 2: Enforce holds in the allocation engine

**Files:**
- Modify: `src/lib/engine.ts`
- Test: `tests/demand/holdExclusion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/demand/holdExclusion.test.ts` (mirrors `tests/demand/binExclusion.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import { allocate } from "../../src/lib/engine";
import { holdKey } from "../../src/lib/holds";
import type { StockRow } from "../../src/lib/types";

function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  return {
    rid: 1,
    location: "SL Mother Hub",
    bin: "A1",
    sku: "SKU-1",
    name: "Product 1",
    batch: "B1",
    exp: [2099, 1],
    qty: 10,
    shelf: 24,
    type: "Good",
    active: "Active",
    ...overrides,
  };
}

describe("allocate — excludes held stock", () => {
  it("never allocates a sku+facility+bin+batch combination that's on hold, even when it's the only stock available", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 50 })];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toEqual([]);
    expect(result.short).toBe(10);
  });

  it("skips the held batch and allocates from an unheld batch of the same sku+bin instead", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "B1", qty: 50 }),
      stockRow({ rid: 2, batch: "B2", qty: 20 }),
    ];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("B2");
  });

  it("does not affect a different sku sitting on the same held bin", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, sku: "SKU-2", batch: "B9", qty: 20 })];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-2", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toHaveLength(1);
  });

  it("allocates normally when heldKeys is omitted", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 50 })];
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/demand/holdExclusion.test.ts`
Expected: FAIL — `heldKeys` does not exist on type `AllocateArgs`

- [ ] **Step 3: Implement the filter**

In `src/lib/engine.ts`, add the import and extend `AllocateArgs`:

```typescript
import type { ChannelRule, Expiry, PickLine, StockRow } from "./types";
import { holdKey } from "./holds";
```

```typescript
export interface AllocateArgs {
  sku: string;
  need: number;
  location: string;
  cutoff: number; // minimum remaining months (already computed from the channel rule)
  stock: StockRow[];
  reservedFor: (rid: number) => number;
  exclude?: number[];
  heldKeys?: Set<string>;
  today?: Date;
}
```

Update the `allocate` function body — change the destructure line and the `eligible` filter:

```typescript
export function allocate(args: AllocateArgs): AllocateResult {
  const { sku, need, location, cutoff, stock, reservedFor } = args;
  const exclude = args.exclude ?? [];
  const heldKeys = args.heldKeys;
  const today = args.today ?? new Date();

  const eligible = stock
    .filter(
      (b) =>
        b.sku === sku &&
        b.location === location &&
        b.type === "Good" &&
        b.active === "Active" &&
        !isExceptionBin(b.bin) &&
        !exclude.includes(b.rid) &&
        !(heldKeys?.has(holdKey(b.sku, b.location, b.bin, b.batch)) ?? false),
    )
    .map((b) => ({ b, rem: monthsRemaining(b.exp, today), av: b.qty - reservedFor(b.rid) }))
    .filter((o) => o.rem >= cutoff && o.av > 0)
    .sort((x, y) => x.rem - y.rem);

  // ... rest unchanged
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/demand/holdExclusion.test.ts tests/demand/binExclusion.test.ts`
Expected: PASS, all tests (new + the existing exception-bin tests still pass unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine.ts tests/demand/holdExclusion.test.ts
git commit -m "feat: exclude held sku+facility+bin+batch combinations from allocation"
```

---

## Task 3: Thread `heldKeys` through the waterfall

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `tests/demand/allocationPreview.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the end of the `describe("computeChannelAllocations ...")` block in `tests/demand/allocationPreview.test.ts` (add the import at the top too):

```typescript
import { activeHoldKeys, holdKey } from "../../src/lib/holds";
```

```typescript
  it("skips a held batch and waterfalls into an unheld one for the same sku+bin", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", batch: "B1", qty: 20 }),
      stockRow({ rid: 2, location: "SL Mother Hub", batch: "B2", qty: 20 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 10 })];
    const heldKeys = activeHoldKeys([
      { id: 1, sku: "TEST-SKU", facility: "SL Mother Hub", bin: "A1", batch: "B1", heldAt: "2026-08-08T00:00:00.000Z", heldBy: "Admin" },
    ]);
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, [], heldKeys);
    const lines = result.byFacility["SL Mother Hub"];
    expect(lines.every((l) => l.batch === "B2")).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/demand/allocationPreview.test.ts`
Expected: FAIL — the held batch is still being allocated, since `computeChannelAllocations` doesn't accept or use `heldKeys` yet

- [ ] **Step 3: Update `waterfall()` and `computeChannelAllocations()` in `src/lib/store.ts`**

Add the import at the top of `src/lib/store.ts` (near the other `./` imports):

```typescript
import { activeHoldKeys, holdKey, holdsToCreate } from "./holds";
```

Update `waterfall()`:

```typescript
function waterfall(
  sku: string,
  need: number,
  cutoff: number,
  stock: StockRow[],
  priority: string[],
  reserved: (rid: number) => number,
  exclude: number[],
  heldKeys: Set<string>,
): { byFacility: Record<string, PickLine[]>; short: number } {
  const byFacility: Record<string, PickLine[]> = {};
  let remain = need;
  for (const facility of priority) {
    if (remain <= 0) break;
    const r = allocate({ sku, need: remain, location: facility, cutoff, stock, reservedFor: reserved, exclude, heldKeys });
    if (r.lines.length) {
      (byFacility[facility] ??= []).push(...r.lines);
      remain = r.short;
    }
  }
  return { byFacility, short: remain };
}
```

Update `computeChannelAllocations()` — add the parameter and pass it through:

```typescript
export function computeChannelAllocations(
  demand: DemandLine[],
  channelRules: Record<string, ChannelRule>,
  skus: Record<string, SkuInfo>,
  stock: StockRow[],
  facilityPriority: string[],
  existingTasks: PickingTask[],
  heldKeys: Set<string> = new Set(),
): ChannelAllocation[] {
  const byGroup = new Map<string, DemandLine[]>();
  for (const d of demand) {
    const key = gatePassGroupKey(d);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(d);
  }

  const reserved = (rid: number) => reservedFor(existingTasks, rid);
  const out: ChannelAllocation[] = [];
  for (const lines of byGroup.values()) {
    const channel = lines[0].channel;
    const gatePassNo = lines[0].gatePassNo;
    const rule = channelRules[channel];
    if (!rule) continue;
    const byFacility: Record<string, PickLine[]> = {};
    const shortfall: Shortfall[] = [];
    for (const d of lines) {
      const cutoff = cutoffMonths(rule, skus[d.sku].shelf);
      const w = waterfall(d.sku, d.qty, cutoff, stock, facilityPriority, reserved, [], heldKeys);
      for (const f of Object.keys(w.byFacility)) (byFacility[f] ??= []).push(...w.byFacility[f]);
      if (w.short > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: w.short });
    }
    out.push({ channel, gatePassNo, byFacility, shortfall });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/demand/allocationPreview.test.ts`
Expected: PASS, all tests including the new one (the default `= new Set()` keeps every existing 6-argument call site compiling unchanged)

- [ ] **Step 5: Run the full type-check**

Run: `npx tsc -b`
Expected: no output (clean) — this catches the two other call sites (`generate()` and the round-2 waterfall in `applyPicks()`) that now need a 8th argument. Task 6 fixes those; for now confirm the compiler flags exactly those two.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts tests/demand/allocationPreview.test.ts
git commit -m "feat: thread held-key exclusion through the waterfall allocator"
```

Note: this commit intentionally leaves `src/lib/store.ts` not type-checking cleanly yet (the two call sites above still pass 7 args). Task 6 fixes it. If your workflow requires every commit to build, squash Tasks 3 and 6 together instead — see the note at the end of Task 6.

---

## Task 4: Supabase I/O for holds

**Files:**
- Create: `src/lib/holdsSupabase.ts`

No test file — this is a thin wrapper around Supabase calls, following the same untested pattern as `src/lib/tasksSupabase.ts`. It cannot be tested without a live database and a service-role key, which this project does not have; it's exercised via manual verification in Task 9.

- [ ] **Step 1: Implement `src/lib/holdsSupabase.ts`**

```typescript
import { supabase } from "./supabaseClient";
import type { Hold } from "./types";

interface HoldRow {
  id: number;
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  held_at: string;
  held_by: string;
  reason: string | null;
  source_task_no: string | null;
  released_at: string | null;
  released_by: string | null;
}

function fromRow(r: HoldRow): Hold {
  return {
    id: r.id,
    sku: r.sku,
    facility: r.facility,
    bin: r.bin,
    batch: r.batch,
    heldAt: r.held_at,
    heldBy: r.held_by,
    reason: r.reason ?? undefined,
    sourceTaskNo: r.source_task_no ?? undefined,
    releasedAt: r.released_at ?? undefined,
    releasedBy: r.released_by ?? undefined,
  };
}

/** Every hold, active and released — callers filter for active client-side. */
export async function fetchHolds(): Promise<Hold[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("stock_holds").select("*").order("held_at", { ascending: false });
  if (error) throw error;
  return (data as HoldRow[]).map(fromRow);
}

export interface NewHold {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  heldBy: string;
  reason?: string;
  sourceTaskNo?: string;
}

export async function insertHold(h: NewHold): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("stock_holds").insert({
    sku: h.sku,
    facility: h.facility,
    bin: h.bin,
    batch: h.batch,
    held_by: h.heldBy,
    reason: h.reason ?? null,
    source_task_no: h.sourceTaskNo ?? null,
  });
  if (error) throw error;
}

export async function releaseHoldRow(id: number, releasedBy: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("stock_holds")
    .update({ released_at: new Date().toISOString(), released_by: releasedBy })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no new errors from this file (the two pre-existing errors from Task 3 remain until Task 6)

- [ ] **Step 3: Commit**

```bash
git add src/lib/holdsSupabase.ts
git commit -m "feat: add Supabase read/write helpers for stock_holds"
```

---

## Task 5: Store state and actions for holds

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add the import**

At the top of `src/lib/store.ts`, add alongside the other imports:

```typescript
import { fetchHolds, insertHold, releaseHoldRow } from "./holdsSupabase";
```

- [ ] **Step 2: Add `holds` to `AppState` and the three new actions**

In the `AppState` interface, add `holds: Hold[];` near `pickers: string[];`:

```typescript
  pickers: string[];
  holds: Hold[];
```

Add `Hold` to the type import at the top of the file (find the existing `import type { ... } from "./types";` block and add `Hold` to it):

```typescript
import type {
  ChannelRule,
  DemandLine,
  FacilityPicklist,
  Hold,
  PickingTask,
  PickLine,
  Shortfall,
  SkuInfo,
  StockRow,
} from "./types";
```

Add the three action signatures to `AppState`, near `addPicker`/`renamePicker`/`removePicker`:

```typescript
  loadHolds: () => Promise<void>;
  placeHold: (h: { sku: string; facility: string; bin: string; batch: string; heldBy: string; reason?: string; sourceTaskNo?: string }) => Promise<void>;
  releaseHold: (id: number, releasedBy: string) => Promise<void>;
```

- [ ] **Step 3: Add `holds: []` to the initial state**

Find `pickers: [...PICKERS_DEFAULT],` in the store's initial state object and add right after it:

```typescript
      pickers: [...PICKERS_DEFAULT],
      holds: [],
```

- [ ] **Step 4: Implement the three actions**

Add this block right after the `removePicker: (name) => set({ pickers: get().pickers.filter((p) => p !== name) }),` line:

```typescript
      loadHolds: async () => {
        if (!isSupabaseConfigured) return;
        try {
          const holds = await fetchHolds();
          set({ holds });
        } catch (e) {
          set({ notice: "Could not load stock holds: " + (e as Error).message });
        }
      },

      placeHold: async (h) => {
        const key = holdKey(h.sku, h.facility, h.bin, h.batch);
        if (activeHoldKeys(get().holds).has(key)) return; // already on hold, nothing to do
        if (!isSupabaseConfigured) return;
        try {
          await insertHold(h);
          await get().loadHolds();
        } catch (e) {
          set({ notice: "Could not place hold: " + (e as Error).message });
        }
      },

      releaseHold: async (id, releasedBy) => {
        if (!isSupabaseConfigured) return;
        try {
          await releaseHoldRow(id, releasedBy);
          await get().loadHolds();
        } catch (e) {
          set({ notice: "Could not release hold: " + (e as Error).message });
        }
      },
```

- [ ] **Step 5: Persist `holds` is NOT needed**

Do not add `holds` to the `partialize` block — holds live in Supabase, not localStorage, same as `tasks`. Skip this step if you find yourself tempted to add it.

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: the two errors about missing `heldKeys` arguments from Task 3 are still present (fixed in Task 6); no new errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: add holds state and loadHolds/placeHold/releaseHold actions"
```

---

## Task 6: Wire holds into generate() and applyPicks()

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Pass `heldKeys` into `generate()`**

Find this line inside `generate:`:

```typescript
        const allocations = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, activeTasks(tasks));
```

Replace it with:

```typescript
        const allocations = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, activeTasks(tasks), activeHoldKeys(get().holds));
```

- [ ] **Step 2: Add a `heldBy` parameter to `applyPicks`**

In the `AppState` interface, update the `applyPicks` signature:

```typescript
  applyPicks: (facilityNo: string, results: Record<number, number>, reasons?: Record<number, string>, heldBy?: string) => Promise<void>;
```

In the implementation, update the function signature:

```typescript
      applyPicks: async (facilityNo, results, reasons, heldBy) => {
```

- [ ] **Step 3: Pass `heldKeys` into the round-2 waterfall call**

Find this block inside `applyPicks`:

```typescript
          const usedRids = new Set(task.facilities.flatMap((f) => f.lines.map((l) => l.rid)));
          const nfBySku: Record<string, number> = {};
          completedFacility.lines.forEach((l) => { if (l.nf) nfBySku[l.sku] = (nfBySku[l.sku] ?? 0) + l.nf; });
          const r2: Record<string, PickLine[]> = {};
          const extraShort: Shortfall[] = [];
          const reserved = (rid: number) => reservedFor(tasks, rid);
          for (const sku of Object.keys(nfBySku)) {
            const cutoff = cutoffMonths(rule, state.skus[sku].shelf);
            const w = waterfall(sku, nfBySku[sku], cutoff, stock, state.facilityPriority, reserved, [...usedRids]);
```

Replace the last two lines with:

```typescript
          const heldKeysForRound2 = activeHoldKeys(state.holds);
          for (const sku of Object.keys(nfBySku)) {
            const cutoff = cutoffMonths(rule, state.skus[sku].shelf);
            const w = waterfall(sku, nfBySku[sku], cutoff, stock, state.facilityPriority, reserved, [...usedRids], heldKeysForRound2);
```

- [ ] **Step 4: Auto-create holds after a completed facility**

Find this line near the end of `applyPicks` (right before the final `set({ tasks, stock, gpSeq, ... })`):

```typescript
        set({ tasks, stock, gpSeq, notice: `${facilityNo} updated.` });
```

Replace it with:

```typescript
        set({ tasks, stock, gpSeq, notice: `${facilityNo} updated.` });

        if (completedFacility) {
          const requests = holdsToCreate(completedFacility.lines, completedFacility.facility, parentTask?.no ?? facilityNo, activeHoldKeys(get().holds));
          for (const req of requests) {
            await get().placeHold({ ...req, heldBy: heldBy ?? "Unknown" });
          }
        }
```

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc -b`
Expected: no output (clean) — this confirms every call site is now consistent

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including everything from Tasks 1–3

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: wire holds into generate() and auto-create holds on not-found"
```

---

## Task 7: Pass the acting user's name into applyPicks

**Files:**
- Modify: `src/components/FacilityBlock.tsx`
- Modify: `src/components/PickerView.tsx`

- [ ] **Step 1: Update `FacilityBlock.tsx`**

Add the import at the top:

```typescript
import { useAuth } from "../lib/authStore";
```

Inside the `FacilityBlock` function, add this line right after the existing `useStore()` destructure:

```typescript
  const myName = useAuth((s) => s.profile?.display_name ?? "Supervisor");
```

Find the `complete()` function:

```typescript
  function complete() {
    const results: Record<number, number> = {};
    lines.forEach((l) => (results[l.rid] = nf[l.rid] ?? 0));
    void applyPicks(f.no, results);
  }
```

Replace the last line with:

```typescript
    void applyPicks(f.no, results, undefined, myName);
```

- [ ] **Step 2: Update `PickerView.tsx`**

`myName` is already defined there via `useAuth`. Find the `advance()` function:

```typescript
      await applyPicks(f.no, nextNf, nextReasons);
```

Replace it with:

```typescript
      await applyPicks(f.no, nextNf, nextReasons, myName);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 4: Commit**

```bash
git add src/components/FacilityBlock.tsx src/components/PickerView.tsx
git commit -m "feat: attribute auto-created holds to whoever completed the picklist"
```

---

## Task 8: Navigation and app wiring

**Files:**
- Modify: `src/lib/navigation.ts`
- Modify: `tests/app/navigation.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing navigation test update**

In `tests/app/navigation.test.ts`, update both the admin and super_admin expected arrays to include "Stock Holds" after "Inventory":

```typescript
  it("orders items for an admin-tier account, with Admin under Settings", () => {
    expect(getNavigation("admin").map((item) => item.label)).toEqual([
      "Demand Planner",
      "Picking Supervisor",
      "Reports",
      "Inventory",
      "Stock Holds",
      "Admin",
    ]);
  });

  it("gives super_admin the same workflow access as admin", () => {
    expect(getNavigation("super_admin").map((item) => item.label)).toEqual([
      "Demand Planner",
      "Picking Supervisor",
      "Reports",
      "Inventory",
      "Stock Holds",
      "Admin",
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/navigation.test.ts`
Expected: FAIL — actual array doesn't include "Stock Holds"

- [ ] **Step 3: Add the nav item**

In `src/lib/navigation.ts`, update the `ViewId` type:

```typescript
export type ViewId = "demand" | "supervisor" | "picker" | "inventory" | "holds" | "reports" | "admin";
```

Add the item to `ALL_ITEMS`, right after `"inventory"`:

```typescript
  { id: "inventory", label: "Inventory", icon: "⌕", section: "shared", roles: ["planner", "admin", "super_admin"] },
  { id: "holds", label: "Stock Holds", icon: "⏸", section: "shared", roles: ["planner", "admin", "super_admin"] },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/navigation.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Wire the view into `App.tsx`**

Add the import near the other component imports:

```typescript
import { StockHolds } from "./components/StockHolds";
```

Update `VIEW_LABEL`:

```typescript
const VIEW_LABEL: Record<ViewId, string> = {
  demand: "Demand Planner",
  supervisor: "Picking Supervisor",
  picker: "Picker",
  inventory: "Inventory",
  holds: "Stock Holds",
  reports: "Reports",
  admin: "Admin",
};
```

Find the `useEffect` that calls `loadTasks()` etc., and add `loadHolds` to both the destructure and the effect body:

```typescript
  const { loadFromSupabase, loadTasks, startTasksRealtime, loadHolds, tasks, flushOfflineQueue } = useStore();
```

```typescript
    void loadFromSupabase();
    void loadTasks();
    void loadHolds();
    void flushOfflineQueue();
```

Find the `unassignedCount` computation and add an `activeHoldsCount` right after it:

```typescript
  const unassignedCount = allFacilityLists(tasks).filter(
    (f) => f.status !== "completed" && !f.lines.some((l) => l.picker),
  ).length;
  const activeHoldsCount = useStore((s) => s.holds).filter((h) => !h.releasedAt).length;
```

Update the `badges` prop and add the view render, right after the `inventory` block:

```typescript
      badges={{ supervisor: unassignedCount, holds: activeHoldsCount }}
```

```typescript
      {activeView === "inventory" && <InventoryPanel />}
      {activeView === "holds" && <StockHolds />}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: will fail here because `StockHolds` doesn't exist yet — that's expected, Task 9 creates it. Confirm the *only* error is the missing module.

- [ ] **Step 7: Commit**

Hold this commit until Task 9 is done — `App.tsx` won't compile until `StockHolds.tsx` exists. Continue directly to Task 9, then commit both together as directed there.

---

## Task 9: Stock Holds screen

**Files:**
- Create: `src/components/StockHolds.tsx`

- [ ] **Step 1: Implement the component**

```typescript
import { useAuth } from "../lib/authStore";
import { useStore } from "../lib/store";
import type { Hold } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function StockHolds() {
  const holds = useStore((s) => s.holds);
  const releaseHold = useStore((s) => s.releaseHold);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");

  const active = holds
    .filter((h) => !h.releasedAt)
    .sort((a, b) => new Date(b.heldAt).getTime() - new Date(a.heldAt).getTime());

  async function release(h: Hold) {
    if (!window.confirm(`Release the hold on ${h.sku} at ${h.facility} / ${h.bin} (batch ${h.batch})? It becomes eligible for future picklists again.`)) return;
    await releaseHold(h.id, myName);
  }

  return (
    <Card title={`Stock holds (${active.length} active)`}>
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        A SKU + Facility + Bin + Batch combination lands here automatically whenever it's marked not-found during
        picking. It stays excluded from every future picklist — fresh or round-2 — until released below.
      </p>
      {active.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds right now.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Bin</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held since</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held by</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reason</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Source picklist</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{h.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.facility}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{h.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.heldBy}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {h.reason ? <Tag tone="warn">{h.reason}</Tag> : "—"}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.sourceTaskNo ?? "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                    <Button variant="sm" onClick={() => void release(h)}>Release</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc -b`
Expected: no output (clean)

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: clean build, no errors (the "chunks larger than 500kB" warning is pre-existing and unrelated)

- [ ] **Step 5: Commit Task 8 and Task 9 together**

```bash
git add src/lib/navigation.ts tests/app/navigation.test.ts src/App.tsx src/components/StockHolds.tsx
git commit -m "feat: add Stock Holds screen, nav entry, and badge count"
```

---

## Task 10: Manual verification against the live database

**Files:** none — this is manual QA, not code.

- [ ] **Step 1: Confirm Task 0's SQL has been run** (skip the rest of this task if not — everything will silently no-op)

- [ ] **Step 2: Deploy or run the dev server, sign in as a Planner or Supervisor**

- [ ] **Step 3: Complete a picklist with at least one line marked not-found**

Expected: the picklist completes normally; round-2 (if the SKU has stock elsewhere) appears as before.

- [ ] **Step 4: Open the new "Stock Holds" nav item**

Expected: the SKU/facility/bin/batch you just marked not-found appears as an active hold, with your name under "Held by" and the not-found reason (if one was given) under "Reason".

- [ ] **Step 5: Generate a fresh picklist for demand on the same SKU, at the same facility**

Expected: if other unheld stock exists for that SKU, it's offered instead of the held bin/batch. If the held lot was the *only* stock, it shows as a shortfall rather than being silently offered.

- [ ] **Step 6: Release the hold from the Stock Holds screen**

Expected: after confirming the dialog, the row disappears from the active list. A fresh allocation for that SKU can now use it again.

- [ ] **Step 7: Report back**

If any step doesn't match, note which step and what happened instead — that's a bug to fix before calling this done, not a manual workaround.

---

## Plan Self-Review Notes

- **Spec coverage:** every requirement in `docs/stock-holds-design.md` maps to a task — the table (Task 0), the enforcement point (Task 2), auto-creation (Task 6), release permissions via nav role gating (Task 8, same `["planner", "admin", "super_admin"]` list used by Reports/Inventory), and the explicitly-out-of-scope items (bulk release, realtime sync, inventory tags) are intentionally not built.
- **Type consistency checked:** `Hold`, `holdKey`, `activeHoldKeys`, `holdsToCreate`, `NewHoldRequest`/`NewHold` field names match exactly between `src/lib/holds.ts`, `src/lib/holdsSupabase.ts`, and every call site in `src/lib/store.ts`.
- **Known ordering quirk:** Task 3 leaves the project not type-checking for one commit (documented inline); Task 6 fixes it two tasks later. This is called out explicitly so whoever executes the plan doesn't think something's broken.
