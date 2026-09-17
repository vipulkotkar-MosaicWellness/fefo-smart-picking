# FEFO-Purity & Breach Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ongoing FEFO-purity cost of case-based picking visible in production — two new metrics (instruction-compliance under the new regime, and a combined metric adjusted for how often the instruction itself deviated from strict FEFO) — without touching the external Apps Script that already scores daily compliance.

**Architecture:** Purely additive, mirroring the `case_size_gaps` pattern already in this codebase. At `generate()` time, run the strict-FEFO allocation (`computeChannelAllocations` with `caseSizes: {}`) alongside the real case-first one on the identical stock snapshot, diff them per lot, and log the delta to a new `fefo_deviations` table — soft-failing, never blocking real task creation. The Gate Pass Adherence screen then joins this new table against the *existing*, *unchanged* `gatepass_adherence` data (written daily by `GatepassAdherenceCheck.gs`) to compute both metrics client-side.

**Tech Stack:** TypeScript, Zustand, Supabase (Postgres + Realtime), Vitest, React (inline SVG charts, no charting library — matches the existing `TrendChart`).

**Business context (for whoever picks this up):** case-based picking (Phase 1) went live 17 Sep 2026. A one-time pre-launch simulation found it would cost ~0.92% FEFO-purity (8,080/880,905 units, 25 Aug–2 Sep). The *existing* Gate Pass Adherence screen ("Pick Compliance & Fulfillment Accuracy", currently 83% over 20 Aug–16 Sep) measures whether the picker followed the instruction — not whether the instruction itself was FEFO-optimal — so that approved cost is currently invisible in all production reporting. Full design/rationale, including the worked numeric examples this plan's test fixtures are drawn from, is in `docs/superpowers/specs/2026-09-17-fefo-purity-reporting-design.md` — read it before starting Task 1.

**Sequencing:** Tasks 1–3 (deviation computation, storage, and generate()-time wiring) must land before Task 4 (the metrics join, which reads deviation data) can be tested meaningfully. Tasks 5–6 (chart/grouping utilities) are independent of 1–4 and can happen in parallel. Task 7 (the screen restructure) depends on everything before it. Task 8 (live migration + verification) runs last.

---

### Task 1: Pure FEFO-deviation diff function

**Files:**
- Create: `src/lib/fefoDeviation.ts`
- Test: `tests/lib/fefoDeviation.test.ts`

Compares the real case-first allocation against what strict FEFO would have picked for the same demand, same stock snapshot, one facility at a time — both already computed elsewhere by `allocate()`/`computeChannelAllocations`. This task does no allocation itself, just the diff.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fefoDeviation.test.ts
import { describe, expect, it } from "vitest";
import { computeFefoDeviation } from "../../src/lib/fefoDeviation";
import type { PickLine } from "../../src/lib/types";

function line(overrides: Partial<PickLine>): PickLine {
  return { rid: 1, sku: "SKU-X", name: "Product X", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2027, 1], rem: 12, qty: 0, ...overrides };
}

describe("computeFefoDeviation", () => {
  it("the design doc's worked example: case-first takes 90 from a later lot + 10 eaches, strict FEFO would take 20 eaches + 80 from the later lot — deviation is 10 units, attributed to the later lot", () => {
    // Need 100, case size 30. Case-first: 3 cases (90) from the later-expiry
    // case-packed lot, 10 loose eaches from the earliest 20-unit bin.
    const caseBasedLines: PickLine[] = [
      line({ rid: 1, bin: "A1", batch: "CASE-LOT", qty: 90, caseQty: 90 }),
      line({ rid: 2, bin: "A5", batch: "EACHES-LOT", qty: 10, eachQty: 10 }),
    ];
    // Strict FEFO: all 20 from the earliest eaches bin first, then 80 from the case lot.
    const strictFefoLines: PickLine[] = [
      line({ rid: 2, bin: "A5", batch: "EACHES-LOT", qty: 20 }),
      line({ rid: 1, bin: "A1", batch: "CASE-LOT", qty: 80 }),
    ];

    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);

    expect(result).toEqual([{ sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviationQty: 10 }]);
  });

  it("no deviation when case-first and strict FEFO agree exactly (no case size configured)", () => {
    const lines: PickLine[] = [line({ rid: 1, bin: "A1", batch: "B1", qty: 50 })];
    const result = computeFefoDeviation(lines, lines);
    expect(result).toEqual([]);
  });

  it("sums quantities from the same lot appearing in multiple lines before diffing", () => {
    const caseBasedLines: PickLine[] = [
      line({ rid: 1, bin: "A1", batch: "B1", qty: 30, caseQty: 30 }),
      line({ rid: 2, bin: "A1", batch: "B1", qty: 10, eachQty: 10 }), // same lot, different rid — e.g. two passes touching it
    ];
    const strictFefoLines: PickLine[] = [line({ rid: 1, bin: "A1", batch: "B1", qty: 25 })];
    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);
    expect(result).toEqual([{ sku: "SKU-X", bin: "A1", batch: "B1", deviationQty: 15 }]);
  });

  it("a lot strict FEFO used but case-first didn't touch at all still isn't a deviation line (deviationQty would be negative, omitted)", () => {
    const caseBasedLines: PickLine[] = [line({ rid: 1, bin: "A9", batch: "LATER", qty: 100, caseQty: 100 })];
    const strictFefoLines: PickLine[] = [
      line({ rid: 2, bin: "A1", batch: "EARLIER", qty: 60 }),
      line({ rid: 1, bin: "A9", batch: "LATER", qty: 40 }),
    ];
    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);
    // Only the lot case-first took MORE from is reported (60 extra on LATER);
    // the EARLIER lot (which case-first skipped) isn't case-first's own line
    // at all, so it can't appear in caseBasedLines to be diffed.
    expect(result).toEqual([{ sku: "SKU-X", bin: "A9", batch: "LATER", deviationQty: 60 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/fefoDeviation.test.ts`
Expected: FAIL — `src/lib/fefoDeviation.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/fefoDeviation.ts
import type { PickLine } from "./types";

export interface FefoDeviationLine {
  sku: string;
  bin: string;
  batch: string;
  /** Units sourced from this lot under case-first beyond what strict FEFO would have used. */
  deviationQty: number;
}

/**
 * Compares the real case-first allocation against what strict FEFO would
 * have picked for the same demand on the same stock snapshot, both already
 * computed for one facility (caller passes `allocate()`'s own PickLine[]
 * output for each mode — see generate() in store.ts for how they're
 * produced side by side). Returns only lots where case-first took MORE than
 * strict FEFO would have — the "breach" side of the diff. The matching
 * "took less" side (e.g. loose eaches left behind) is implied: the two
 * sides always sum to the same total units, so reporting one side is
 * enough to know the full deviation amount without double-reporting it.
 */
export function computeFefoDeviation(caseBasedLines: PickLine[], strictFefoLines: PickLine[]): FefoDeviationLine[] {
  function byLot(lines: PickLine[]): Map<string, { sku: string; bin: string; batch: string; qty: number }> {
    const map = new Map<string, { sku: string; bin: string; batch: string; qty: number }>();
    for (const l of lines) {
      const key = `${l.sku}|${l.bin}|${l.batch}`;
      const cur = map.get(key) ?? { sku: l.sku, bin: l.bin, batch: l.batch, qty: 0 };
      cur.qty += l.qty;
      map.set(key, cur);
    }
    return map;
  }

  const caseBasedByLot = byLot(caseBasedLines);
  const fefoByLot = byLot(strictFefoLines);

  const out: FefoDeviationLine[] = [];
  for (const [key, lot] of caseBasedByLot) {
    const fefoQty = fefoByLot.get(key)?.qty ?? 0;
    const deviationQty = lot.qty - fefoQty;
    if (deviationQty > 0) out.push({ sku: lot.sku, bin: lot.bin, batch: lot.batch, deviationQty });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/fefoDeviation.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — this is a new, standalone file with no other callers yet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fefoDeviation.ts tests/lib/fefoDeviation.test.ts
git commit -m "feat: pure diff function comparing case-first allocation against strict-FEFO counterfactual"
```

---

### Task 2: `fefo_deviations` Supabase table + sync module

**Files:**
- Create: `supabase/add_fefo_deviations_table.sql`
- Create: `src/lib/fefoDeviationsSupabase.ts`
- Test: `tests/lib/fefoDeviationsSupabase.test.ts`

Mirrors `case_size_gaps`/`caseSizesSupabase.ts`'s `logCaseSizeGaps` pattern exactly: written automatically as a side effect of a real `generate()` call, so broader write access than `case_sizes` itself (Admin-only).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fefoDeviationsSupabase.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}));

describe("logFefoDeviations", () => {
  it("inserts one row per deviation line, carrying facility and gate pass number", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const insert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table !== "fefo_deviations") throw new Error(`unexpected table ${table}`);
      return { insert } as never;
    });

    await logFefoDeviations("SL Mother Hub", "GPSLMH12345", [
      { sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviationQty: 10 },
    ]);

    expect(insert).toHaveBeenCalledWith([
      { gate_pass_no: "GPSLMH12345", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10 },
    ]);
  });

  it("stores a null gate pass number when the facility is still Gate Pass Allocation Pending", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const insert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ insert }) as never);

    await logFefoDeviations("SL Mother Hub", undefined, [{ sku: "SKU-X", bin: "A1", batch: "B1", deviationQty: 5 }]);

    expect(insert).toHaveBeenCalledWith([
      { gate_pass_no: null, facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 5 },
    ]);
  });

  it("does nothing when there are no deviation lines", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    await logFefoDeviations("SL Mother Hub", "GPSLMH12345", []);
    expect(supabase!.from).not.toHaveBeenCalled();
  });
});

describe("fetchFefoDeviations", () => {
  it("selects rows created on or after the given date", async () => {
    const { fetchFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const gte = vi.fn(async () => ({ data: [{ gate_pass_no: "GPSLMH1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" }], error: null }));
    const select = vi.fn(() => ({ gte }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ select }) as never);

    const rows = await fetchFefoDeviations("2026-09-17");

    expect(select).toHaveBeenCalledWith("gate_pass_no,facility,sku,bin,batch,deviation_qty,created_at");
    expect(gte).toHaveBeenCalledWith("created_at", "2026-09-17");
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/fefoDeviationsSupabase.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```sql
-- supabase/add_fefo_deviations_table.sql
--
-- FEFO Smart Picking — records, per real order, every lot where case-first
-- allocation took MORE units than strict FEFO would have on the same stock
-- snapshot (see computeFefoDeviation in src/lib/fefoDeviation.ts). This is
-- the raw data behind the "Case-based + FEFO breach" metric on the Gate
-- Pass Adherence screen — see
-- docs/superpowers/specs/2026-09-17-fefo-purity-reporting-design.md.
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.

create table if not exists fefo_deviations (
  id             bigint generated always as identity primary key,
  -- Nullable: a facility still sitting in "Gate Pass Allocation Pending" at
  -- generate() time has no gate pass number yet. Such rows simply won't
  -- join against gatepass_adherence until (if ever) one is added — see the
  -- design doc's note on this being an accepted, soft-visibility gap.
  gate_pass_no   text,
  facility       text not null,
  sku            text not null,
  bin            text not null,
  batch          text not null,
  deviation_qty  integer not null check (deviation_qty > 0),
  created_at     timestamptz not null default now()
);

alter table fefo_deviations enable row level security;

create policy "read fefo deviations" on fefo_deviations for select to authenticated using (true);

-- Written automatically by generate() as a side effect of a real order, so
-- any role that can create a picklist (planner/admin/super_admin) needs
-- write access here — same reasoning as case_size_gaps.
create policy "log fefo deviations" on fefo_deviations for insert to authenticated with check (true);
```

```ts
// src/lib/fefoDeviationsSupabase.ts
import { supabase } from "./supabaseClient";
import type { FefoDeviationLine } from "./fefoDeviation";

export interface FefoDeviationRow {
  gate_pass_no: string | null;
  facility: string;
  sku: string;
  bin: string;
  batch: string;
  deviation_qty: number;
  created_at: string;
}

/**
 * Logs one row per deviation line for a single facility's picklist — called
 * from generate() for a REAL order only, right alongside case-size gap
 * logging. `gatePassNo` is whatever generate() already resolved for this
 * facility at creation time (possibly none yet — see the table's own
 * comment on gate_pass_no).
 */
export async function logFefoDeviations(facility: string, gatePassNo: string | undefined, lines: FefoDeviationLine[]): Promise<void> {
  if (!supabase || lines.length === 0) return;
  const rows = lines.map((l) => ({
    gate_pass_no: gatePassNo ?? null,
    facility,
    sku: l.sku,
    bin: l.bin,
    batch: l.batch,
    deviation_qty: l.deviationQty,
  }));
  const { error } = await supabase.from("fefo_deviations").insert(rows);
  if (error) throw error;
}

/** Rows created on or after `sinceDate` (YYYY-MM-DD) — the reporting screen filters to whatever window it's showing. */
export async function fetchFefoDeviations(sinceDate: string): Promise<FefoDeviationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("fefo_deviations").select("gate_pass_no,facility,sku,bin,batch,deviation_qty,created_at").gte("created_at", sinceDate);
  if (error) throw error;
  return (data ?? []) as FefoDeviationRow[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/fefoDeviationsSupabase.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Do NOT run the SQL migration against Supabase**

No credentials are available to the implementer for this; a human runs it separately, same as every other migration in this project. Skip straight to Step 6.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/add_fefo_deviations_table.sql src/lib/fefoDeviationsSupabase.ts tests/lib/fefoDeviationsSupabase.test.ts
git commit -m "feat: add fefo_deviations table and sync module"
```

---

### Task 3: Wire deviation computation into `generate()`

**Files:**
- Modify: `src/lib/store.ts`
- Test: `tests/demand/fefoDeviationLogging.test.ts`

Right alongside the existing case-size gap logging in `generate()` (added in the earlier case-based-picking plan), compute the strict-FEFO counterfactual for the same demand and log any deviations.

- [ ] **Step 1: Write the failing test**

```ts
// tests/demand/fefoDeviationLogging.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

const logFefoDeviations = vi.fn(async () => undefined);
vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return { ...actual, logFefoDeviations };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — logs FEFO deviation for a real order on a case-configured SKU", () => {
  afterEach(() => {
    logFefoDeviations.mockClear();
    vi.resetModules();
  });

  it("logs a deviation when case-first takes more from a lot than strict FEFO would have", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initial = useStore.getState();

    // 20 units at earliest expiry (loose, no case), 500 at a later expiry
    // (case-packed lot). Need 100, case size 30: case-first takes 3 cases
    // (90) from the later lot + 10 eaches from the earliest bin — a
    // 10-unit deviation on the later lot, exactly the design doc's example.
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A5", sku: "SKU-DEV", name: "Product", batch: "EACHES-LOT", exp: [2027, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      { rid: 2, location: "SL Mother Hub", bin: "A1", sku: "SKU-DEV", name: "Product", batch: "CASE-LOT", exp: [2027, 6], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-DEV": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-DEV": 30 }, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-DEV", qty: 100, gatePassNo: "GP-DEV-1" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logFefoDeviations).toHaveBeenCalledWith(
      "SL Mother Hub",
      "GP-DEV-1",
      [{ sku: "SKU-DEV", bin: "A1", batch: "CASE-LOT", deviationQty: 10 }],
    );

    useStore.setState(initial, true);
  });

  it("does NOT compute or log anything when no SKU in the demand has a case size configured", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initial = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-PLAIN", name: "Product", batch: "B1", exp: [2027, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-PLAIN": { name: "Product", shelf: 24 } }, caseSizes: {}, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-PLAIN", qty: 50, gatePassNo: "GP-DEV-2" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logFefoDeviations).not.toHaveBeenCalled();

    useStore.setState(initial, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/demand/fefoDeviationLogging.test.ts`
Expected: FAIL — `generate()` doesn't compute or log deviations yet.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`, add the import (alongside the existing `caseSizesSupabase`/`fefoDeviation` imports):
```ts
import { computeFefoDeviation } from "./fefoDeviation";
import { logFefoDeviations } from "./fefoDeviationsSupabase";
```

Right after the existing case-size gap logging block inside `generate()` (immediately following the `if (isSupabaseConfigured) { const gaps = ... }` block already there), add:

```ts
        // Also once per generate() call, right after gap logging above —
        // computes what strict FEFO would have allocated for the SAME
        // demand on the SAME stock snapshot, and logs the delta per lot.
        // Skipped entirely when no SKU in this demand has a case size
        // configured: case-first and strict-FEFO are then guaranteed
        // identical, so there's nothing to compute. The two
        // computeChannelAllocations calls receive the exact same `demand`
        // array in the exact same order, and grouping is a pure function of
        // `demand` alone (caseSizes only affects per-group allocation, not
        // which group a line belongs to) — so allocations[i] and
        // strictFefoAllocations[i] are guaranteed to be the same channel
        // group, safe to match by index.
        if (isSupabaseConfigured && demand.some((d) => get().caseSizes[d.sku])) {
          const strictFefoAllocations = computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks), activeHoldKeys(get().holds), {});
          for (let i = 0; i < allocations.length; i++) {
            const caseBased = allocations[i];
            const strictFefo = strictFefoAllocations[i];
            for (const facility of Object.keys(caseBased.byFacility)) {
              const deviations = computeFefoDeviation(caseBased.byFacility[facility], strictFefo.byFacility[facility] ?? []);
              if (deviations.length > 0) {
                try {
                  await logFefoDeviations(facility, caseBased.gatePassByFacility[facility], deviations);
                } catch {
                  // Logging failure must never block real task creation — this is visibility, not a gate.
                }
              }
            }
          }
        }
```

Verify the real current variable names in scope at that exact point (`demand`, `channelRules`, `skus`, `stock`, `tasks`, `allocations`, `get().holds`, `get().caseSizes`) match what's shown — this plan was written against the current file, but confirm before pasting.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/demand/fefoDeviationLogging.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts tests/demand/fefoDeviationLogging.test.ts
git commit -m "feat: log FEFO deviation against a strict-FEFO counterfactual on every real order"
```

---

### Task 4: `computePurityMetrics()` — the Metric 1 / Metric 2 join

**Files:**
- Create: `src/lib/fefoPurityMetrics.ts`
- Test: `tests/lib/fefoPurityMetrics.test.ts`

Metric 1 is exactly today's existing compliance calculation — no new code needed for it beyond calling it on the right subset of rows (done in Task 7). This task is Metric 2: joining deviation rows against compliance data using the conservative bound agreed in the design doc.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fefoPurityMetrics.test.ts
import { describe, expect, it } from "vitest";
import { computePurityMetrics } from "../../src/lib/fefoPurityMetrics";
import type { GatepassAdherence } from "../../src/lib/gatepassAdherenceSupabase";
import type { FefoDeviationRow } from "../../src/lib/fefoDeviationsSupabase";

function adherenceRow(overrides: Partial<GatepassAdherence>): GatepassAdherence {
  return {
    gatepass_code: "GP-1", facility: "SL Mother Hub", report_date: "2026-09-17",
    instructed_qty: 100, compliant_qty: 100, adherence_pct: 100, lines: [],
    ...overrides,
  };
}

describe("computePurityMetrics", () => {
  it("the design doc's worked example: 95% compliance, 10-unit breach, conservative combine -> 85%", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 95, adherence_pct: 95 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" },
    ];

    const result = computePurityMetrics(adherenceRows, deviationRows);

    expect(result.metric1Pct).toBe(95);
    expect(result.breachQty).toBe(10);
    expect(result.complianceMissQty).toBe(5);
    expect(result.metric2Pct).toBe(85);
  });

  it("Metric 2 equals Metric 1 when there's no deviation data at all for the window", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ instructed_qty: 200, compliant_qty: 190, adherence_pct: 95 })];
    const result = computePurityMetrics(adherenceRows, []);
    expect(result.metric1Pct).toBe(95);
    expect(result.breachQty).toBe(0);
    expect(result.metric2Pct).toBe(95);
  });

  it("ignores a deviation row whose gate pass isn't in this window's adherence rows at all", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      // GP-2 was never reconciled in this window (still pending, or outside the date range) — must not count.
      { gate_pass_no: "GP-2", facility: "SL Mother Hub", sku: "SKU-Y", bin: "A1", batch: "B1", deviation_qty: 50, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(0);
    expect(result.metric2Pct).toBe(100);
  });

  it("ignores a deviation row with no gate pass number yet (still Gate Pass Allocation Pending)", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: null, facility: "SL Mother Hub", sku: "SKU-Y", bin: "A1", batch: "B1", deviation_qty: 20, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(0);
  });

  it("sums breach across multiple deviation rows for the same gate pass", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 6, created_at: "2026-09-17T00:00:00.000Z" },
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-Y", bin: "A2", batch: "B2", deviation_qty: 4, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(10);
  });

  it("returns 0% for both metrics when instructedQty is 0, not NaN or a divide-by-zero error", () => {
    const result = computePurityMetrics([], []);
    expect(result.metric1Pct).toBe(0);
    expect(result.metric2Pct).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/fefoPurityMetrics.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/fefoPurityMetrics.ts
import type { GatepassAdherence } from "./gatepassAdherenceSupabase";
import type { FefoDeviationRow } from "./fefoDeviationsSupabase";

export interface PurityMetrics {
  /** Pure case-based % — today's existing compliance metric, unchanged method, just scoped to this window. */
  metric1Pct: number;
  /** Metric 1 minus FEFO-breach %, conservative (assume-disjoint) bound — see the design doc. */
  metric2Pct: number;
  instructedQty: number;
  /** Total FEFO-deviation units counted in this window. */
  breachQty: number;
  /** Total units that failed the existing compliance check. */
  complianceMissQty: number;
}

/**
 * Metric 1 needs no join — it's exactly the existing adherence calculation
 * on whichever rows the caller passes in. Metric 2 joins deviation rows
 * against those SAME rows by gate pass number, so a deviation logged for a
 * gate pass outside this window (not yet reconciled, or from a different
 * date range) is correctly excluded rather than silently counted. When a
 * gate pass has both compliance-miss units and deviation units, we can't
 * tell — without unit serials, which no WMS tracks — whether they're the
 * same physical units, so both counts are subtracted independently (the
 * conservative, worst-case bound) rather than assuming overlap. Full
 * rationale and the worked numeric example this test file's fixtures come
 * from: docs/superpowers/specs/2026-09-17-fefo-purity-reporting-design.md.
 */
export function computePurityMetrics(adherenceRows: GatepassAdherence[], deviationRows: FefoDeviationRow[]): PurityMetrics {
  const instructedQty = adherenceRows.reduce((s, r) => s + r.instructed_qty, 0);
  const compliantQty = adherenceRows.reduce((s, r) => s + r.compliant_qty, 0);
  const complianceMissQty = instructedQty - compliantQty;
  const metric1Pct = instructedQty ? Math.round((compliantQty / instructedQty) * 10000) / 100 : 0;

  const gatePassesInWindow = new Set(adherenceRows.map((r) => r.gatepass_code));
  const breachQty = deviationRows
    .filter((d) => d.gate_pass_no && gatePassesInWindow.has(d.gate_pass_no))
    .reduce((s, d) => s + d.deviation_qty, 0);

  const badQty = complianceMissQty + breachQty;
  const metric2Pct = instructedQty ? Math.round(((instructedQty - badQty) / instructedQty) * 10000) / 100 : 0;

  return { metric1Pct, metric2Pct, instructedQty, breachQty, complianceMissQty };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/fefoPurityMetrics.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fefoPurityMetrics.ts tests/lib/fefoPurityMetrics.test.ts
git commit -m "feat: join FEFO-deviation data against gate pass adherence for the combined purity metric"
```

---

### Task 5: `TrendChart` gains an optional connecting trendline

**Files:**
- Modify: `src/components/GatepassAdherence.tsx`
- Test: `tests/components/GatepassAdherenceTrendline.test.tsx`

Vipul asked for the new charts (and the restructured historical one) to show a connecting trendline with dot markers on top of the existing bars, matching a reference format he shared — not just bars. The existing `TrendChart` already renders daily bars well; this task adds the overlay as an opt-in prop so nothing about its current (bars-only) usage changes unless asked.

- [ ] **Step 1: Read `TrendChart` in full first** (in `src/components/GatepassAdherence.tsx`, currently taking `{ days, selectedDate, onSelectDate }`) to confirm the exact current SVG layout constants (`padL`, `padT`, `chartH`, `slot`, `barW`, etc.) before adding to them — this plan's line numbers may have shifted slightly after Tasks 1–4 touch other files, but this component is untouched by those tasks, so it should still match.

- [ ] **Step 2: Write the failing test**

```tsx
// tests/components/GatepassAdherenceTrendline.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// TrendChart isn't exported today — this test drives adding `export` to it,
// the minimal change, not a restructure.
import { TrendChart } from "../../src/components/GatepassAdherence";

function day(date: string, pct: number) {
  return { date, gatepassCount: 1, instructedQty: 100, compliantQty: pct, pct, rows: [] };
}

describe("TrendChart — optional trendline overlay", () => {
  it("renders no polyline or point circles when showTrendline is omitted (existing bars-only behavior unchanged)", () => {
    const { container } = render(<TrendChart days={[day("2026-09-15", 80), day("2026-09-16", 90)]} selectedDate={null} onSelectDate={() => {}} />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("renders a connecting polyline and one dot per day when showTrendline is true", () => {
    const { container } = render(<TrendChart days={[day("2026-09-15", 80), day("2026-09-16", 90), day("2026-09-17", 85)]} selectedDate={null} onSelectDate={() => {}} showTrendline />);
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/GatepassAdherenceTrendline.test.tsx`
Expected: FAIL — `TrendChart` isn't exported yet, and has no `showTrendline` prop.

- [ ] **Step 4: Write minimal implementation**

In `src/components/GatepassAdherence.tsx`:

Add `export` to the `TrendChart` function declaration (minimal change — it stays defined in this same file, just importable for the test and for reuse in Task 7):
```tsx
export function TrendChart({ days, selectedDate, onSelectDate, showTrendline }: { days: DaySummary[]; selectedDate: string | null; onSelectDate: (date: string) => void; showTrendline?: boolean }) {
```

Inside the `<svg>`, after the days `.map(...)` block that draws the bars (right before the closing baseline `<line>` at the bottom of the chart), add the trendline overlay — drawn after the bars so it sits visually on top:

```tsx
          {showTrendline && days.length > 1 && (
            <polyline
              points={days.map((d, i) => `${padL + slot * i + slot / 2},${padT + chartH - (d.pct / 100) * chartH}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-teal-700 dark:text-teal-300"
              opacity={0.7}
            />
          )}
          {showTrendline &&
            days.map((d, i) => (
              <circle
                key={`dot-${d.date}`}
                cx={padL + slot * i + slot / 2}
                cy={padT + chartH - (d.pct / 100) * chartH}
                r={3}
                fill="currentColor"
                className="text-teal-700 dark:text-teal-300"
              />
            ))}
```

(Use the real current `padL`/`slot`/`padT`/`chartH` variable names from the file exactly as they already exist — this is illustrative, confirm against the actual component before pasting.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/GatepassAdherenceTrendline.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no existing test renders `TrendChart` with `showTrendline`, so none of them hit the new branch.

- [ ] **Step 7: Commit**

```bash
git add src/components/GatepassAdherence.tsx tests/components/GatepassAdherenceTrendline.test.tsx
git commit -m "feat: TrendChart gains an optional connecting trendline overlay"
```

---

### Task 6: Weekly grouping for the historical baseline

**Files:**
- Modify: `src/components/GatepassAdherence.tsx`
- Test: `tests/components/GatepassAdherenceByWeek.test.tsx`

**Files:**

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/GatepassAdherenceByWeek.test.tsx
import { describe, expect, it } from "vitest";
import { byWeek } from "../../src/components/GatepassAdherence";
import type { GatepassAdherence as GatepassAdherenceRow } from "../../src/lib/gatepassAdherenceSupabase";

function row(reportDate: string, instructed: number, compliant: number): GatepassAdherenceRow {
  return { gatepass_code: `GP-${reportDate}`, facility: "SL Mother Hub", report_date: reportDate, instructed_qty: instructed, compliant_qty: compliant, adherence_pct: (compliant / instructed) * 100, lines: [] };
}

describe("byWeek", () => {
  it("groups rows into Mon-Sun weeks and sums instructed/compliant unit-weighted", () => {
    // 20-26 Aug 2026 is a Thu-Wed span starting mid-week; the real historical
    // window (confirmed live: earliest report_date 2026-08-20) starts on a
    // Thursday, so week 1 here is a partial week by design, not a bug.
    const rows = [row("2026-08-20", 100, 80), row("2026-08-21", 100, 90), row("2026-08-27", 200, 190)];
    const weeks = byWeek(rows);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].instructedQty).toBe(200);
    expect(weeks[0].compliantQty).toBe(170);
    expect(weeks[0].pct).toBe(85);
    expect(weeks[1].instructedQty).toBe(200);
  });

  it("sorts weeks chronologically", () => {
    const rows = [row("2026-09-03", 100, 100), row("2026-08-20", 100, 50)];
    const weeks = byWeek(rows);
    expect(weeks[0].date < weeks[1].date).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/GatepassAdherenceByWeek.test.tsx`
Expected: FAIL — `byWeek` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/GatepassAdherence.tsx`, add near the existing `byDay` function (same file, same `DaySummary` return shape — a week is just another "period summary", not a new type):

```ts
/** Monday of the Mon-Sun week containing this date, as YYYY-MM-DD. UTC throughout — report_date is a plain date string with no timezone of its own, matching byDay's convention. */
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** Same shape as byDay, one row per Mon-Sun week instead of per day — for the pure-FEFO historical baseline, which has too many days to read one-by-one. */
export function byWeek(rows: GatepassAdherenceRow[]): DaySummary[] {
  const groups = new Map<string, GatepassAdherenceRow[]>();
  for (const r of rows) {
    const wk = weekStart(r.report_date);
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk)!.push(r);
  }
  return [...groups.entries()]
    .map(([wk, weekRows]) => {
      const instructedQty = weekRows.reduce((s, r) => s + r.instructed_qty, 0);
      const compliantQty = weekRows.reduce((s, r) => s + r.compliant_qty, 0);
      return {
        date: wk,
        gatepassCount: weekRows.length,
        instructedQty,
        compliantQty,
        pct: instructedQty ? Math.round((compliantQty / instructedQty) * 10000) / 100 : 0,
        rows: weekRows,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/GatepassAdherenceByWeek.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/GatepassAdherence.tsx tests/components/GatepassAdherenceByWeek.test.tsx
git commit -m "feat: weekly grouping for the pure-FEFO historical baseline"
```

---

### Task 7: Restructure the Gate Pass Adherence screen

**Files:**
- Modify: `src/components/GatepassAdherence.tsx`
- Test: `tests/components/GatepassAdherenceRestructure.test.tsx`

The big integration task: fetch the new deviation data, split existing adherence rows into "case-based era" (17 Sep onward) vs "pure-FEFO baseline" (before), and render the two new metric sections above the existing (now weekly-charted) historical section.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/GatepassAdherenceRestructure.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gatepassAdherenceSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gatepassAdherenceSupabase")>();
  return {
    ...actual,
    fetchGatepassAdherence: vi.fn(async () => [
      // Pure-FEFO baseline (before launch)
      { gatepass_code: "GP-OLD-1", facility: "SL Mother Hub", report_date: "2026-08-20", instructed_qty: 100, compliant_qty: 80, adherence_pct: 80, lines: [] },
      // Case-based era (on/after launch)
      { gatepass_code: "GP-NEW-1", facility: "SL Mother Hub", report_date: "2026-09-17", instructed_qty: 100, compliant_qty: 95, adherence_pct: 95, lines: [] },
    ]),
  };
});

vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return {
    ...actual,
    fetchFefoDeviations: vi.fn(async () => [
      { gate_pass_no: "GP-NEW-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" },
    ]),
  };
});

describe("GatepassAdherence — restructured screen", () => {
  it("shows Metric 1 and Metric 2 for the case-based era, and the pure-FEFO baseline separately below", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    expect(await screen.findByText(/Pure case-based/i)).toBeInTheDocument();
    // "95%" appears in both the chart's value label and the new table's Tag
    // cell for this metric — getAllByText, not getByText, since both are
    // real and expected, not a duplicate-render bug.
    expect((await screen.findAllByText(/95%/)).length).toBeGreaterThan(0); // Metric 1

    expect(await screen.findByText(/FEFO breach/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/85%/)).length).toBeGreaterThan(0); // Metric 2: 95 - 10 = 85

    // The pure-FEFO baseline section still shows the old 80% day, kept separate.
    expect((await screen.findAllByText(/80%/)).length).toBeGreaterThan(0);
  });
});
```

Note: check `GatepassAdherence.tsx`'s actual rendered text/structure once Task 7's implementation is drafted, and adjust selectors here to match exactly what's real — the test's job is to prove the two new metrics compute and render correctly from real fetched data, and that the old baseline stays visibly separate.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/GatepassAdherenceRestructure.test.tsx`
Expected: FAIL — no Metric 1/2 sections exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/GatepassAdherence.tsx`:

Add the imports:
```ts
import { fetchFefoDeviations, type FefoDeviationRow } from "../lib/fefoDeviationsSupabase";
import { computePurityMetrics } from "../lib/fefoPurityMetrics";

// The date case-based picking went live — everything on/after this splits
// into the new top section; everything before stays in the historical
// pure-FEFO baseline below. A plain literal, same convention as other
// fixed cutoff dates in this codebase (e.g. AdminConfig's cutoffDate).
const CASE_BASED_LAUNCH_DATE = "2026-09-17";
```

Add `fefoDeviations` state and fetch it alongside the existing `rows` fetch in the component's `useEffect`:
```ts
  const [fefoDeviations, setFefoDeviations] = useState<FefoDeviationRow[]>([]);
  // ... inside the existing useEffect, alongside the fetchGatepassAdherence call:
  fetchFefoDeviations(CASE_BASED_LAUNCH_DATE)
    .then((r) => { if (!cancelled) setFefoDeviations(r); })
    .catch(() => { /* non-fatal — Metric 2 just shows 0 breach if this fails */ });
```
(Match the exact current `useEffect`/state-setting pattern already in the file — this is illustrative of what needs to be added, not a full rewrite of the effect.)

Split `days` into the two eras and compute both metrics, alongside the existing `days`/`overallPct` computation:
```ts
  const caseBasedRows = rows.filter((r) => r.report_date >= CASE_BASED_LAUNCH_DATE);
  const baselineRows = rows.filter((r) => r.report_date < CASE_BASED_LAUNCH_DATE);
  const caseBasedDays = useMemo(() => byDay(caseBasedRows), [caseBasedRows]);
  const baselineWeeks = useMemo(() => byWeek(baselineRows), [baselineRows]);
  const purity = computePurityMetrics(caseBasedRows, fefoDeviations);
  // Metric 1 and Metric 2 per-day, for their own trend charts:
  const metric1Days = caseBasedDays.slice(-15);
  const metric2Days = caseBasedDays
    .slice(-15)
    .map((d) => ({ ...d, pct: computePurityMetrics(d.rows, fefoDeviations).metric2Pct }));
```

Add the new top section, above the existing `<div className="mb-4 flex flex-wrap items-start justify-between ...">` header block (which becomes the start of the *baseline* section now — wrap the entire existing JSX body, from that header through the daily-log/trend-chart grid, in a clearly-labeled "Pure-FEFO baseline" wrapper, and insert this new block before it):

```tsx
      {caseBasedRows.length > 0 && (
        <div className="mb-6 border-b border-[var(--fefo-line)] pb-6 dark:border-slate-700">
          <h2 className="mb-1 text-xl font-bold tracking-tight text-[var(--fefo-text)] dark:text-slate-100">
            Case-Based Picking — Live Since {shortDateLabel(CASE_BASED_LAUNCH_DATE)}
          </h2>
          <p className="mb-4 max-w-2xl text-sm text-[var(--fefo-muted)] dark:text-slate-400">
            Two numbers, day by day: whether the instructed batch was picked as instructed (unchanged method), and that
            same number further adjusted for units where case-first picking itself chose a later-expiry batch than strict
            FEFO would have.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-1 text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">Pure case-based %</p>
              <p className="mb-3 text-sm text-[var(--fefo-muted)] dark:text-slate-400">Last 15 days · same compliance rule as always</p>
              <TrendChart days={metric1Days} selectedDate={null} onSelectDate={() => {}} showTrendline />
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-xs uppercase tracking-wide text-teal-800 dark:text-teal-300">
                      <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Date</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Pure case-based %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric1Days.map((d) => (
                      <tr key={d.date} className="text-slate-700 dark:text-slate-200">
                        <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{d.date}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.instructedQty.toLocaleString()}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.compliantQty.toLocaleString()}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                          <Tag tone={pctTone(d.pct)}>{pctDisplay(d.pct)}</Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-1 text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">Case-based + FEFO breach %</p>
              <p className="mb-3 text-sm text-[var(--fefo-muted)] dark:text-slate-400">
                Last 15 days · {purity.breachQty.toLocaleString()} units breached FEFO out of {purity.instructedQty.toLocaleString()}
              </p>
              <TrendChart days={metric2Days} selectedDate={null} onSelectDate={() => {}} showTrendline />
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-xs uppercase tracking-wide text-teal-800 dark:text-teal-300">
                      <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Date</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Breach units</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Case-based + FEFO breach %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric1Days.map((d) => {
                      const dayPurity = computePurityMetrics(d.rows, fefoDeviations);
                      return (
                        <tr key={d.date} className="text-slate-700 dark:text-slate-200">
                          <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{d.date}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{dayPurity.instructedQty.toLocaleString()}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{dayPurity.breachQty.toLocaleString()}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                            <Tag tone={pctTone(dayPurity.metric2Pct)}>{pctDisplay(dayPurity.metric2Pct)}</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
```

(`metric2Days` above is reused for the chart's `pct` values; the table recomputes `computePurityMetrics` per day via `metric1Days` + `d.rows` instead of relying on `metric2Days`' derived `pct` field, so the table's Instructed/Breach columns have real numbers to show, not just a bare percentage — both read from the same underlying `d.rows`, so they can't disagree.)

Then, in the existing (now-baseline) section: replace the current `<TrendChart days={days.slice(-14)} ... />` call with `<TrendChart days={baselineWeeks} selectedDate={expandedDate} onSelectDate={selectDate} showTrendline />`, and update its header text (currently "Daily adherence trend" / "Last 14 days") to something like "Pure-FEFO baseline — weekly" / "Every week before case-based picking went live", so the two sections read as clearly distinct at a glance. Keep the existing daily log table, best/worst-day cards, and gate-pass/line drill-down exactly as they are, still driven by `baselineRows`/`days` (rename the existing `rows`-derived values to operate on `baselineRows` specifically, so the "Overall adherence" stat card etc. reflect the pre-launch baseline only, not mixed with the new era).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/GatepassAdherenceRestructure.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — check whether any EXISTING test for this component (search `tests/` for other files rendering `GatepassAdherence`) now needs its fixture data adjusted to account for the new date-based split (e.g., a fixture using dates before 17 Sep will now land entirely in the baseline section, which may change what text/stat values that older test expects to see in what used to be the only section).

- [ ] **Step 6: Commit**

```bash
git add src/components/GatepassAdherence.tsx tests/components/GatepassAdherenceRestructure.test.tsx
git commit -m "feat: restructure Gate Pass Adherence screen with live case-based metrics above the pure-FEFO baseline"
```

---

### Task 8: Live migration and verification

**Files:** none — data/verification only, no code changes.

- [ ] **Step 1: Run the migration**

Run `supabase/add_fefo_deviations_table.sql` in Supabase → SQL Editor. Confirm:
```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;
```
`fefo_deviations` is intentionally NOT added to realtime (same reasoning as `case_size_gaps` — a reporting table, not something other screens need live-pushed to them) — this check is just to confirm the table itself exists and RLS is active, not to look for it in this list.

- [ ] **Step 2: Confirm it's live**

Raise one small real test order (same pattern as the earlier case-based-picking rollout: pick a low-volume, case-size-configured SKU, generate, confirm a deviation row appears if the allocation actually deviates, then discard the picklist same as before). Open the Gate Pass Adherence screen and confirm the new top section renders (it may show "0 breach units" if the test order didn't happen to deviate — that's fine, the point is confirming it renders without error against live data).

- [ ] **Step 3: Report back**

No commit needed for this task. Report to Vipul: migration applied, live spot-check result, and what the screen actually shows once real case-based orders have accumulated a few days of history.
