# Picking Supervisor: Filters + Round History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Picking Supervisor screen finer-grained date filters, a new Business Type filter, and — reused from Picklist Repository — a round-history tab switcher on any picklist that has re-offers, so a supervisor can see a gate pass's full Original/Round 2/Round 3 story (including facility changes) without leaving the triage view.

**Architecture:** Additive on top of the existing 4-bucket pipeline-stage layout (unchanged). A new `reofferedFrom` field fixes a real gap in the existing family-grouping logic (`groupPicklistFamilies`) so re-offers link correctly even when they land on a different facility than their parent. A new shared `RoundTabs` component replaces the inline tab-switcher currently duplicated inside Picklist Repository, and gets reused in Supervisor's `PicklistItem`. A new `businessTypes.ts` provides a filter-only channel→business-type lookup, deliberately independent of the existing `CHANNEL_BUCKETS` numbering taxonomy.

**Tech Stack:** React + TypeScript, Zustand store, Tailwind, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-14-picking-supervisor-family-view-design.md` (see there for what's explicitly out of scope — the Gatepass report reconciliation trigger, merging Supervisor/Repository, updating task-numbering taxonomy).

---

## File Structure

- **Modify `src/lib/ageing.ts`** — add `yesterday2`/`yesterday3`/`yesterday4` presets.
- **Modify `src/components/AgeingFilter.tsx`** — render the 3 new presets.
- **Modify `src/lib/types.ts`** — add `reofferedFrom?: string` to `FacilityPicklist`.
- **Modify `src/lib/store.ts`** — stamp `reofferedFrom` when a not-found re-offer is created.
- **Modify `src/lib/picklistFamilies.ts`** — `groupPicklistFamilies` follows `reofferedFrom` chains (falls back to today's same-facility guess when absent); add `familyFor()` lookup helper.
- **Create `src/components/RoundTabs.tsx`** — shared round-history tab switcher (facility-labeled tabs, amber dot on a facility change, restrained 2-color scheme), extracted from Picklist Repository's inline JSX.
- **Modify `src/components/PicklistRepository.tsx`** — use `<RoundTabs>` instead of its inline tabs; default view flips from latest-round to Round 1 (Original).
- **Modify `src/components/SupervisorQueue.tsx`** — `PicklistItem` shows `<RoundTabs>` when its picklist belongs to a multi-round family; new Business Type filter dropdown.
- **Modify `src/components/FacilityBlock.tsx`** — de-emphasize the internal `gp` reference number so it reads as "Internal ref:", never mistaken for a second real gate pass number.
- **Create `src/lib/businessTypes.ts`** — the Business Type mapping (from `docs/superpowers/specs/2026-09-14-business-type-mapping.csv`), filter-only.
- **Test files** — one per behavior, listed in each task below.

---

### Task 1: Finer-grained date presets (Yesterday -2/-3/-4)

**Files:**
- Modify: `src/lib/ageing.ts`
- Modify: `src/components/AgeingFilter.tsx`
- Test: `tests/repository/ageing.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/repository/ageing.test.ts`, inside the existing `describe("ageingRangeFor", ...)` block (after the `last30` test, before `custom`):

```ts
  it("yesterday2 spans the day before yesterday", () => {
    const r = ageingRangeFor("yesterday2", now);
    expect(r.start.getDate()).toBe(13);
    expect(r.end.getDate()).toBe(14);
  });

  it("yesterday3 spans 3 days back", () => {
    const r = ageingRangeFor("yesterday3", now);
    expect(r.start.getDate()).toBe(12);
    expect(r.end.getDate()).toBe(13);
  });

  it("yesterday4 spans 4 days back", () => {
    const r = ageingRangeFor("yesterday4", now);
    expect(r.start.getDate()).toBe(11);
    expect(r.end.getDate()).toBe(12);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/repository/ageing.test.ts`
Expected: FAIL — TypeScript error, `"yesterday2"` is not assignable to `AgeingPreset`.

- [ ] **Step 3: Implement**

In `src/lib/ageing.ts`, replace the whole file's top section (type, labels, and the `yesterday` case in `ageingRangeFor`) as follows.

Replace:

```ts
export type AgeingPreset = "today" | "yesterday" | "last7" | "last30" | "custom";

export const AGEING_PRESET_LABEL: Record<AgeingPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  custom: "Custom range",
};
```

with:

```ts
export type AgeingPreset = "today" | "yesterday" | "yesterday2" | "yesterday3" | "yesterday4" | "last7" | "last30" | "custom";

export const AGEING_PRESET_LABEL: Record<AgeingPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  yesterday2: "Yesterday -2",
  yesterday3: "Yesterday -3",
  yesterday4: "Yesterday -4",
  last7: "Last 7 days",
  last30: "Last 30 days",
  custom: "Custom range",
};
```

Then replace the `case "yesterday":` block inside `ageingRangeFor`:

```ts
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { start: y, end: today };
    }
```

with a shared helper plus 4 cases that use it — replace it with:

```ts
    case "yesterday":
      return daysAgoRange(today, 1);
    case "yesterday2":
      return daysAgoRange(today, 2);
    case "yesterday3":
      return daysAgoRange(today, 3);
    case "yesterday4":
      return daysAgoRange(today, 4);
```

And add the helper function just above `ageingRangeFor` (below `startOfDay`):

```ts
/** The single calendar day exactly `daysBack` days before `today` — [start, end) spanning just that one day. */
function daysAgoRange(today: Date, daysBack: number): AgeingRange {
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack);
  const end = new Date(today);
  end.setDate(end.getDate() - (daysBack - 1));
  return { start, end };
}
```

In `src/components/AgeingFilter.tsx`, replace:

```ts
const PRESETS: AgeingPreset[] = ["today", "yesterday", "last7", "last30", "custom"];
```

with:

```ts
const PRESETS: AgeingPreset[] = ["today", "yesterday", "yesterday2", "yesterday3", "yesterday4", "last7", "last30", "custom"];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/repository/ageing.test.ts`
Expected: PASS (13 tests — 10 existing + 3 new)

- [ ] **Step 5: Run the full suite to check nothing else broke**

Run: `npm run test:run`
Expected: PASS — `Reports.tsx` also uses `AgeingFilter`/`AgeingPreset`, so confirm no type errors there either (it renders whatever `PRESETS` gives it, no hardcoded list of its own).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ageing.ts src/components/AgeingFilter.tsx tests/repository/ageing.test.ts
git commit -m "Add Yesterday -2/-3/-4 date presets"
```

---

### Task 2: `reofferedFrom` field, stamped when a re-offer is created

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/store.ts`
- Test: `tests/demand/reofferedFrom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/demand/reofferedFrom.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("reofferedFrom", () => {
  it("stamps the originating facility's .no onto a round-2 re-offer that lands on a DIFFERENT facility", async () => {
    const stockRows: StockRow[] = [
      { rid: 301, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO", name: "Product RO", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      // Only stock left for the not-found qty is at a facility round 1 never touched.
      { rid: 302, location: "SL Ambient", bin: "C1", sku: "SKU-RO", name: "Product RO", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO", qty: 15, gatePassNo: "GPSLMH-RO1" }],
      facilities: [
        {
          no: "TASK-RO-MH",
          taskNo: "TASK-RO",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO1",
          lines: [{ rid: 301, sku: "SKU-RO", name: "Product RO", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO": { name: "Product RO", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-RO-MH", { 301: 5 }, { 301: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-RO");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2).toBeDefined();
    expect(r2!.facility).toBe("SL Ambient"); // confirms it DID land on a different facility
    expect(r2!.reofferedFrom).toBe("TASK-RO-MH");
  });

  it("also stamps it for a same-facility re-offer, not just the cross-facility case", async () => {
    const stockRows: StockRow[] = [
      { rid: 401, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO2", name: "Product RO2", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      { rid: 402, location: "SL Mother Hub", bin: "A2", sku: "SKU-RO2", name: "Product RO2", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO2",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO2", qty: 15, gatePassNo: "GPSLMH-RO2" }],
      facilities: [
        {
          no: "TASK-RO2-MH",
          taskNo: "TASK-RO2",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO2",
          lines: [{ rid: 401, sku: "SKU-RO2", name: "Product RO2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO2": { name: "Product RO2", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-RO2-MH", { 401: 5 }, { 401: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-RO2");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2!.facility).toBe("SL Mother Hub");
    expect(r2!.reofferedFrom).toBe("TASK-RO2-MH");
  });

  it("round 1 itself has no reofferedFrom", async () => {
    const stockRows: StockRow[] = [
      { rid: 501, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO3", name: "Product RO3", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO3",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO3", qty: 15, gatePassNo: "GPSLMH-RO3" }],
      facilities: [
        {
          no: "TASK-RO3-MH",
          taskNo: "TASK-RO3",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO3",
          lines: [{ rid: 501, sku: "SKU-RO3", name: "Product RO3", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO3": { name: "Product RO3", shelf: 24 } }, tasks: [task] });

    const round1 = useStore.getState().tasks[0].facilities[0];
    expect(round1.reofferedFrom).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/reofferedFrom.test.ts`
Expected: FAIL — TypeScript error, `reofferedFrom` doesn't exist on `FacilityPicklist`, plus the runtime assertions would be `undefined` even once it compiles.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/types.ts`, inside the `FacilityPicklist` interface, add the new field right after the `round` field:

```ts
  round: number; // 1 = first pass, 2 = round-2 (re-offer of not-found)
  // The exact facility picklist `.no` of the shortfall round that triggered
  // this one, when this round IS a re-offer (round > 1). Lets
  // groupPicklistFamilies() link a re-offer back to its original even when
  // it landed on a DIFFERENT facility than the one that came up short — the
  // facility-suffix-based fallback (primaryFacilityNo) only works when a
  // re-offer stays on the same facility. Undefined for round 1, and for any
  // round-2+ picklist created before this field existed (no backfill is
  // possible for those — see the 14 Sep 2026 design spec).
  reofferedFrom?: string;
```

In `src/lib/store.ts`, update `buildFacilityLists` to accept and stamp an optional `reofferedFrom` — replace:

```ts
function buildFacilityLists(
  taskNo: string,
  round: number,
  byFacility: Record<string, PickLine[]>,
  priority: string[],
  suffix = "",
  gatePassByFacility: Record<string, string | undefined> = {},
): FacilityPicklist[] {
  const createdAt = new Date().toISOString();
  return priority
    .filter((f) => byFacility[f]?.length)
    .map((f) => ({
      no: `${taskNo}-${facilityCode(f)}${suffix}`,
      taskNo,
      facility: f,
      status: "open" as const,
      round,
      bad: 0,
      lines: byFacility[f],
      createdAt,
      gatePassNo: gatePassByFacility[f],
    }));
}
```

with:

```ts
function buildFacilityLists(
  taskNo: string,
  round: number,
  byFacility: Record<string, PickLine[]>,
  priority: string[],
  suffix = "",
  gatePassByFacility: Record<string, string | undefined> = {},
  reofferedFrom?: string,
): FacilityPicklist[] {
  const createdAt = new Date().toISOString();
  return priority
    .filter((f) => byFacility[f]?.length)
    .map((f) => ({
      no: `${taskNo}-${facilityCode(f)}${suffix}`,
      taskNo,
      facility: f,
      status: "open" as const,
      round,
      bad: 0,
      lines: byFacility[f],
      createdAt,
      gatePassNo: gatePassByFacility[f],
      ...(reofferedFrom ? { reofferedFrom } : {}),
    }));
}
```

Then find the round-2+ call site (search for `` `-R${round}` `` in `src/lib/store.ts` — it's inside the not-found re-offer block, right after `roundsNeeded`/`r2Lists` are computed). Replace:

```ts
            return buildFacilityLists(task.no, round, subset, state.facilityPriority, `-R${round}`, gatePassByFacility);
```

with:

```ts
            return buildFacilityLists(task.no, round, subset, state.facilityPriority, `-R${round}`, gatePassByFacility, completedFacility!.no);
```

(`completedFacility` is already in scope in this block — it's the exact round whose not-found lines triggered this whole re-offer batch, regardless of which facility the re-offer itself lands on.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/reofferedFrom.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the round-2 regression suite to confirm nothing broke**

Run: `npx vitest run tests/demand/roundTwoGatePass.test.ts tests/demand/roundTwoAutoCompleteRepro.test.ts`
Expected: PASS — these exercise the same `buildFacilityLists` call site; confirms the new optional param didn't change any existing behavior for callers that don't pass it (round 1's call at the `generate()` call site never passes `reofferedFrom`, so it stays `undefined` there, exactly as before).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/store.ts tests/demand/reofferedFrom.test.ts
git commit -m "Stamp reofferedFrom on not-found re-offers, including cross-facility ones"
```

---

### Task 3: `groupPicklistFamilies` follows `reofferedFrom`, plus `familyFor()` lookup

**Files:**
- Modify: `src/lib/picklistFamilies.ts`
- Test: `tests/repository/picklistFamilies.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/repository/picklistFamilies.test.ts`, inside the existing `describe("groupPicklistFamilies", ...)` block (after the last existing `it`, before the closing `});`):

```ts
  it("links a re-offer to its original via reofferedFrom even when it landed on a different facility", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", facility: "SL Mother Hub", round: 1, status: "completed", bad: 5 }),
        facility({ no: "TASK-1-AMB-R2", facility: "SL Ambient", round: 2, reofferedFrom: "TASK-1-MH" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
    expect(families[0].rounds.map((r) => r.no)).toEqual(["TASK-1-MH", "TASK-1-AMB-R2"]);
  });

  it("walks a multi-hop reofferedFrom chain back to the original", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-AMB-R2", facility: "SL Ambient", round: 2, reofferedFrom: "TASK-1-MH" }),
        facility({ no: "TASK-1-RX-R3", facility: "SL RX", round: 3, reofferedFrom: "TASK-1-AMB-R2" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
    expect(families[0].rounds.map((r) => r.no)).toEqual(["TASK-1-MH", "TASK-1-AMB-R2", "TASK-1-RX-R3"]);
  });

  it("falls back to the same-facility-suffix guess when reofferedFrom is absent (historical data)", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-MH-R2", round: 2 }), // no reofferedFrom — pre-existing data shape
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
  });
});

describe("familyFor", () => {
  it("finds the family containing a given facility picklist", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-MH-R2", round: 2 }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    const target = t.facilities[1];
    expect(familyFor(target, families)?.rounds).toHaveLength(2);
  });

  it("returns undefined when the facility isn't in any given family", () => {
    expect(familyFor(facility({ no: "GHOST" }), [])).toBeUndefined();
  });
```

(Note: this appends TWO closing braces worth of new content — the first `it` block goes inside the existing `describe("groupPicklistFamilies", ...)`, closes it, then opens a brand new `describe("familyFor", ...)` block. Make sure the file's final `});` still closes that new `describe` block — i.e. the file should end with exactly one `});` after these additions, not two.)

Update the import line at the top of the file:

```ts
import { groupPicklistFamilies } from "../../src/lib/picklistFamilies";
```

becomes:

```ts
import { familyFor, groupPicklistFamilies } from "../../src/lib/picklistFamilies";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/repository/picklistFamilies.test.ts`
Expected: FAIL — `familyFor` is not exported yet; the cross-facility and multi-hop tests would group into separate families under the current suffix-only logic.

- [ ] **Step 3: Write minimal implementation**

Replace the whole `groupPicklistFamilies` function in `src/lib/picklistFamilies.ts`:

```ts
export function groupPicklistFamilies(tasks: PickingTask[]): PicklistFamily[] {
  const families = new Map<string, PicklistFamily>();

  for (const t of tasks) {
    const byNo = new Map(t.facilities.map((f) => [f.no, f] as const));
    // Follows the reofferedFrom chain back to the root (round 1, or as far
    // back as the chain goes) when present. A round-3 re-offer's
    // reofferedFrom points at round 2, not round 1 directly, so this
    // recurses. Falls back to the old same-facility-suffix guess
    // (primaryFacilityNo) for round 1 itself, and for any round whose
    // reofferedFrom is missing or points somewhere unresolvable (historical
    // data from before this field existed, or a malformed/self-referencing
    // link) — the `parent.no !== f.no` guard exists specifically so a
    // self-referencing link can't recurse forever.
    const rootKeyOf = (f: FacilityPicklist): string => {
      if (f.round <= 1) return f.no;
      if (f.reofferedFrom) {
        const parent = byNo.get(f.reofferedFrom);
        if (parent && parent.no !== f.no) return rootKeyOf(parent);
      }
      return primaryFacilityNo(f.no);
    };

    for (const f of t.facilities) {
      const key = rootKeyOf(f);
      let fam = families.get(key);
      if (!fam) {
        fam = { key, taskNo: t.no, rounds: [], latestCreatedAt: t.createdAt };
        families.set(key, fam);
      }
      fam.rounds.push(f);
      const roundTime = f.createdAt ?? t.createdAt;
      if (new Date(roundTime).getTime() > new Date(fam.latestCreatedAt).getTime()) {
        fam.latestCreatedAt = roundTime;
      }
    }
  }

  for (const fam of families.values()) fam.rounds.sort((a, b) => a.round - b.round);
  return [...families.values()];
}

/** Which family (if any) a specific facility picklist belongs to, from an already-computed family list. */
export function familyFor(f: FacilityPicklist, families: PicklistFamily[]): PicklistFamily | undefined {
  return families.find((fam) => fam.rounds.some((r) => r.no === f.no));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/repository/picklistFamilies.test.ts`
Expected: PASS (10 tests — 5 existing + 3 new grouping + 2 new `familyFor`)

- [ ] **Step 5: Commit**

```bash
git add src/lib/picklistFamilies.ts tests/repository/picklistFamilies.test.ts
git commit -m "groupPicklistFamilies: follow reofferedFrom chains, add familyFor() lookup"
```

---

### Task 4: Shared `RoundTabs` component; fix Repository's default-to-latest bug

**Files:**
- Create: `src/components/RoundTabs.tsx`
- Modify: `src/components/PicklistRepository.tsx`
- Test: `tests/repository/roundTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/repository/roundTabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoundTabs } from "../../src/components/RoundTabs";
import type { PicklistFamily } from "../../src/lib/picklistFamilies";
import type { FacilityPicklist } from "../../src/lib/types";

function round(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "T-MH", taskNo: "T", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
    lines: [], ...overrides,
  };
}

describe("RoundTabs", () => {
  it("renders nothing for a single-round family", () => {
    const family: PicklistFamily = { key: "T-MH", taskNo: "T", rounds: [round()], latestCreatedAt: "2026-09-14T00:00:00Z" };
    const { container } = render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels round 1 as Original and later rounds as Round N, each with its facility", () => {
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [round({ round: 1, facility: "SL Mother Hub" }), round({ no: "T-AMB-R2", round: 2, facility: "SL Ambient" })],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    expect(screen.getByText(/Original/)).toBeInTheDocument();
    expect(screen.getByText(/SL Mother Hub/)).toBeInTheDocument();
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByText(/SL Ambient/)).toBeInTheDocument();
  });

  it("shows a facility-change marker only on a tab whose facility differs from the previous round", () => {
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [
        round({ round: 1, facility: "SL Mother Hub" }),
        round({ no: "T-MH-R2", round: 2, facility: "SL Mother Hub" }), // same facility as round 1
        round({ no: "T-AMB-R3", round: 3, facility: "SL Ambient" }), // different facility
      ],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    const markers = screen.getAllByTitle("Moved to a different facility than the previous round");
    expect(markers).toHaveLength(1);
  });

  it("calls onSelectRound with the clicked round's number", async () => {
    const user = userEvent.setup();
    const onSelectRound = vi.fn();
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [round({ round: 1 }), round({ no: "T-MH-R2", round: 2 })],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={onSelectRound} />);
    await user.click(screen.getByRole("button", { name: /Round 2/ }));
    expect(onSelectRound).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/repository/roundTabs.test.tsx`
Expected: FAIL — `src/components/RoundTabs.tsx` doesn't exist yet.

- [ ] **Step 3: Create the component**

Create `src/components/RoundTabs.tsx`:

```tsx
import type { PicklistFamily } from "../lib/picklistFamilies";
import { Tag } from "./Ui";

export function roundLabel(round: number): string {
  if (round === 1) return "Original";
  return `Round ${round}`;
}

/**
 * Round-history tab switcher for a picklist family — Original / Round 2 /
 * Round 3..., each labeled with its own facility so a facility change
 * between rounds is visible just by reading across the tabs, no click
 * required. Shared between Picklist Repository and Picking Supervisor —
 * same component, same behavior, so a supervisor sees exactly what an
 * auditor looking at Repository would see for the same gate pass.
 *
 * Deliberately restrained colors: one accent (teal) for the selected tab,
 * neutral gray/white for the rest, and a single small amber dot as the
 * only additional marker — meaning "this round's facility differs from the
 * previous round's," not a new color per state.
 */
export function RoundTabs({
  family,
  selectedRound,
  onSelectRound,
}: {
  family: PicklistFamily;
  selectedRound: number;
  onSelectRound: (round: number) => void;
}) {
  if (family.rounds.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800">
      {family.rounds.map((r, i) => {
        const prev = family.rounds[i - 1];
        const facilityChanged = i > 0 && prev.facility !== r.facility;
        return (
          <button
            key={r.round}
            onClick={() => onSelectRound(r.round)}
            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
              selectedRound === r.round ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {roundLabel(r.round)} · {r.facility}
            {facilityChanged && (
              <span className="ml-1 text-amber-500" title="Moved to a different facility than the previous round">●</span>
            )}
            {r.round === 1 && r.bad > 0 && <Tag tone="bad">short</Tag>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/repository/roundTabs.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Refactor Picklist Repository to use it, and fix the default-to-latest-round bug**

In `src/components/PicklistRepository.tsx`:

Replace the import line:

```ts
import { groupPicklistFamilies, type PicklistFamily } from "../lib/picklistFamilies";
```

with:

```ts
import { groupPicklistFamilies, type PicklistFamily } from "../lib/picklistFamilies";
import { roundLabel, RoundTabs } from "./RoundTabs";
```

Remove the local `roundLabel` function (it's now imported instead) — delete these lines:

```ts
function roundLabel(round: number): string {
  if (round === 1) return "Original";
  if (round === 2) return "Not-Found Re-offer";
  return `Round ${round}`;
}
```

(Note: the removed local version special-cased round 2 as "Not-Found Re-offer" — the shared `RoundTabs` version says "Round 2" for every round beyond the original, consistently. This is an intentional simplification: every round beyond 1 is a not-found re-offer by definition, so singling out round 2 with different wording than round 3+ added inconsistency without adding information.)

In the `FamilyRow` function, replace the inline tab-switcher block:

```tsx
        {hasAlternates && (
          <div className="flex gap-1 rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800">
            {family.rounds.map((r) => (
              <button
                key={r.round}
                onClick={() => onSelectRound(r.round)}
                className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                  active.round === r.round ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {roundLabel(r.round)}
                {r.round === 1 && r.bad > 0 && <Tag tone="bad">short</Tag>}
              </button>
            ))}
          </div>
        )}
```

with:

```tsx
        {hasAlternates && <RoundTabs family={family} selectedRound={active.round} onSelectRound={onSelectRound} />}
```

(`hasAlternates` stays as-is — it's still used just above this to decide whether to render anything at all; `RoundTabs` itself also self-guards with the same `rounds.length <= 1` check, so this is a harmless double-guard, not a bug.)

Finally, fix the default: in the `PicklistRepository` function, replace:

```ts
              selectedRound={selectedRounds[fam.key] ?? fam.rounds[fam.rounds.length - 1].round}
```

with:

```ts
              selectedRound={selectedRounds[fam.key] ?? fam.rounds[0].round}
```

- [ ] **Step 6: Run the full repository test suite**

Run: `npx vitest run tests/repository/`
Expected: PASS — all existing Repository tests plus the new `roundTabs.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/RoundTabs.tsx src/components/PicklistRepository.tsx tests/repository/roundTabs.test.tsx
git commit -m "Extract shared RoundTabs component; Repository now defaults to Original, not latest round"
```

---

### Task 5: Round history in Picking Supervisor

**Files:**
- Modify: `src/components/SupervisorQueue.tsx`
- Test: `tests/supervisor/roundHistoryInSupervisor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/supervisor/roundHistoryInSupervisor.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SupervisorQueue } from "../../src/components/SupervisorQueue";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();

afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function taskWithHistory(): PickingTask {
  return {
    no: "TASK-HIST",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-10T00:00:00Z",
    facilities: [
      {
        no: "TASK-HIST-MH",
        taskNo: "TASK-HIST",
        facility: "SL Mother Hub",
        status: "completed",
        round: 1,
        bad: 3,
        gatePassNo: "GP-ORIGINAL",
        createdAt: "2026-09-10T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, picked: 7, nf: 3 }],
      },
      {
        no: "TASK-HIST-AMB-R2",
        taskNo: "TASK-HIST",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        gatePassNo: "GP-ROUND2",
        createdAt: "2026-09-13T00:00:00Z",
        reofferedFrom: "TASK-HIST-MH",
        lines: [{ rid: 2, sku: "SKU1", name: "Product", facility: "SL Ambient", bin: "C1", batch: "B2", exp: [2099, 2], rem: 12, qty: 3 }],
      },
    ],
  };
}

function taskWithoutHistory(): PickingTask {
  return {
    no: "TASK-PLAIN",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-13T00:00:00Z",
    facilities: [
      {
        no: "TASK-PLAIN-MH",
        taskNo: "TASK-PLAIN",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GP-PLAIN",
        createdAt: "2026-09-13T00:00:00Z",
        lines: [{ rid: 3, sku: "SKU2", name: "Product 2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
      },
    ],
  };
}

describe("SupervisorQueue — round history", () => {
  it("shows round tabs for a picklist with a multi-round family, defaulting to Original", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithHistory()] });
    render(<SupervisorQueue />);

    // The Round 2 entry (GP-ROUND2) is the one that actually sits in the open
    // queue — its card should show tabs, defaulting to showing the Original's
    // gate pass number since selectedRound defaults to 1.
    expect(screen.getByText(/Original/)).toBeInTheDocument();
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByText(/GP-ORIGINAL/)).toBeInTheDocument();
  });

  it("switches to Round 2's own gate pass number when its tab is clicked", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithHistory()] });
    render(<SupervisorQueue />);

    await user.click(screen.getByRole("button", { name: /Round 2/ }));

    expect(screen.getByText(/GP-ROUND2/)).toBeInTheDocument();
  });

  it("shows no round tabs for a picklist with no re-offer history", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithoutHistory()] });
    render(<SupervisorQueue />);

    expect(screen.getByText(/GP-PLAIN/)).toBeInTheDocument();
    expect(screen.queryByText(/Original/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/roundHistoryInSupervisor.test.tsx`
Expected: FAIL — no round tabs render yet anywhere in `SupervisorQueue`.

- [ ] **Step 3: Wire `RoundTabs` into `PicklistItem`**

In `src/components/SupervisorQueue.tsx`, update the imports at the top — replace:

```tsx
import { useEffect, useMemo, useState } from "react";
import { ageingRangeFor, formatAge, inAgeingRange, type AgeingPreset } from "../lib/ageing";
import { primaryFacilityNo } from "../lib/format";
import { activeTasks, effectiveGatePassNo, supervisorVisibleFacilityLists, useStore } from "../lib/store";
import { bucketSummary, matchesSupervisorSearch, needsAttentionList, queueBucket, queueMetrics } from "../lib/supervisorMetrics";
import type { FacilityPicklist, PickingTask } from "../lib/types";
import { AgeingFilter } from "./AgeingFilter";
import { PartnerMark } from "./partners/PartnerMark";
import { Card, Tag } from "./Ui";
import { FacilityBlock } from "./FacilityBlock";
```

with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { ageingRangeFor, formatAge, inAgeingRange, type AgeingPreset } from "../lib/ageing";
import { primaryFacilityNo } from "../lib/format";
import { familyFor, groupPicklistFamilies, type PicklistFamily } from "../lib/picklistFamilies";
import { activeTasks, effectiveGatePassNo, supervisorVisibleFacilityLists, useStore } from "../lib/store";
import { bucketSummary, matchesSupervisorSearch, needsAttentionList, queueBucket, queueMetrics } from "../lib/supervisorMetrics";
import type { FacilityPicklist, PickingTask } from "../lib/types";
import { AgeingFilter } from "./AgeingFilter";
import { PartnerMark } from "./partners/PartnerMark";
import { RoundTabs } from "./RoundTabs";
import { Card, Tag } from "./Ui";
import { FacilityBlock } from "./FacilityBlock";
```

Replace the whole `PicklistItem` function with:

```tsx
// ageLabel and unassigned are meant to be passed together (both or neither):
// unassigned only affects the badge's tone, so unassigned=true with no
// ageLabel renders nothing and silently drops the intended signal.
function PicklistItem({
  f,
  channel,
  gatePassNo,
  queuePos,
  ageLabel,
  unassigned,
  family,
  tasks,
}: {
  f: FacilityPicklist;
  channel: string;
  gatePassNo?: string;
  queuePos?: number;
  ageLabel?: string;
  unassigned?: boolean;
  // When this picklist belongs to a multi-round family (an original plus at
  // least one not-found re-offer), round tabs render above the accordion and
  // switching tabs shows that round's own facility/gate pass/lines — not
  // just the single `f` this card happened to be filed under. Undefined or
  // a single-round family renders exactly as before: just `f`.
  family?: PicklistFamily;
  tasks: PickingTask[];
}) {
  // FacilityBlock renders one input + one select per line — mounting all of
  // them for every picklist in the queue (hundreds at once, thousands of
  // lines) is what made this page unusably heavy: 245k+ DOM nodes measured
  // live with 355 open picklists. A closed native <details> only hides
  // content visually; React still mounts it. Deferring the mount until this
  // item has actually been opened once fixes that — and staying mounted
  // afterward (not toggling back off) means a supervisor's in-progress
  // not-found entries survive if the accordion gets collapsed again.
  const [hasOpened, setHasOpened] = useState(false);
  const hasHistory = (family?.rounds.length ?? 0) > 1;
  // Defaults to Round 1 (Original) — never the latest/most dramatic round —
  // so a supervisor opening a card sees what the order originally looked
  // like before anything went not-found, not "Round 3 / Not Found" first.
  const [selectedRound, setSelectedRound] = useState(1);
  const active = hasHistory ? (family!.rounds.find((r) => r.round === selectedRound) ?? f) : f;
  const activeChannel = active === f ? channel : channelOf(active, tasks);
  const activeGatePass = active === f ? gatePassNo : gatePassOf(active, tasks);

  return (
    <div className="mt-2">
      {hasHistory && (
        <div className="mb-1.5">
          <RoundTabs family={family!} selectedRound={selectedRound} onSelectRound={setSelectedRound} />
        </div>
      )}
      <details
        className="rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden"
        onToggle={(e) => {
          if (e.currentTarget.open) setHasOpened(true);
        }}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900">
          <span className="flex items-center gap-1.5 text-sm">
            {queuePos != null && <Tag tone="info">#{queuePos}</Tag>}
            {ageLabel != null && <Tag tone={unassigned ? "bad" : "warn"}>{ageLabel}</Tag>}
            {activeChannel && <PartnerMark name={activeChannel} compact />}
            <b>{active.facility}</b>{" "}
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {activeGatePass ? `Gate Pass ${activeGatePass} · ` : ""}{active.no}
            </span>{" "}
            {active.round > 1 && !hasHistory && (
              <Tag tone="info">Alternate Picklist — for {primaryFacilityNo(active.no)}</Tag>
            )}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{summary(active)}</span>
        </summary>
        <div className="border-t border-slate-200 p-2.5 dark:border-slate-700">
          {hasOpened && <FacilityBlock f={active} gatePassNo={activeGatePass} />}
        </div>
      </details>
    </div>
  );
}
```

(Note: `active.round > 1 && !hasHistory` — the old "Alternate Picklist — for ..." tag only shows now when there's no `family` info available at all, i.e. for data where family grouping couldn't determine any siblings. When `hasHistory` is true, `RoundTabs` already conveys the same "this is an alternate" information more usefully via the tabs themselves, so showing both would be redundant.)

- [ ] **Step 4: Thread `families`/`tasks` through `Bucket`**

Replace the `Bucket` function's props type and body — replace:

```tsx
function Bucket({
  title,
  tone,
  items,
  channelFor,
  gatePassFor,
  emptyText,
  queued,
  showAge,
  createdAtFor,
  now,
}: {
  title: string;
  tone: "warn" | "info" | "ok" | "bad";
  items: FacilityPicklist[];
  channelFor: (f: FacilityPicklist) => string;
  gatePassFor: (f: FacilityPicklist) => string | undefined;
  emptyText: string;
  queued?: boolean;
  // When set, each row gets an age tag (and unassigned ones get the "bad"
  // tone instead of "warn") — used only for the WMS Blocked bucket, whose
  // `items` are pre-sorted unassigned-then-oldest-first by the caller (see
  // needsAttentionList). Other buckets keep their plain creation order.
  showAge?: boolean;
  createdAtFor?: (f: FacilityPicklist) => string;
  now?: Date;
}) {
```

with:

```tsx
function Bucket({
  title,
  tone,
  items,
  channelFor,
  gatePassFor,
  emptyText,
  queued,
  showAge,
  createdAtFor,
  now,
  families,
  tasks,
}: {
  title: string;
  tone: "warn" | "info" | "ok" | "bad";
  items: FacilityPicklist[];
  channelFor: (f: FacilityPicklist) => string;
  gatePassFor: (f: FacilityPicklist) => string | undefined;
  emptyText: string;
  queued?: boolean;
  // When set, each row gets an age tag (and unassigned ones get the "bad"
  // tone instead of "warn") — used only for the WMS Blocked bucket, whose
  // `items` are pre-sorted unassigned-then-oldest-first by the caller (see
  // needsAttentionList). Other buckets keep their plain creation order.
  showAge?: boolean;
  createdAtFor?: (f: FacilityPicklist) => string;
  now?: Date;
  families: PicklistFamily[];
  tasks: PickingTask[];
}) {
```

Then replace the `items.map(...)` block inside `Bucket`:

```tsx
        {items.map((f, i) => (
          <PicklistItem
            key={f.no}
            f={f}
            channel={channelFor(f)}
            gatePassNo={gatePassFor(f)}
            queuePos={queued ? i + 1 : undefined}
            ageLabel={showAge && createdAtFor && now ? formatAge(createdAtFor(f), now) : undefined}
            unassigned={showAge ? !f.lines.some((l) => l.picker) : undefined}
          />
        ))}
```

with:

```tsx
        {items.map((f, i) => (
          <PicklistItem
            key={f.no}
            f={f}
            channel={channelFor(f)}
            gatePassNo={gatePassFor(f)}
            queuePos={queued ? i + 1 : undefined}
            ageLabel={showAge && createdAtFor && now ? formatAge(createdAtFor(f), now) : undefined}
            unassigned={showAge ? !f.lines.some((l) => l.picker) : undefined}
            family={familyFor(f, families)}
            tasks={tasks}
          />
        ))}
```

- [ ] **Step 5: Compute `families` once in `SupervisorQueue` and pass to every `Bucket` call**

Inside `export function SupervisorQueue()`, add this alongside the other `useMemo`s (right after the `channelOptions` line):

```tsx
  const families = useMemo(() => groupPicklistFamilies(tasks), [tasks]);
```

Then update all 4 `<Bucket .../>` calls to add `families={families} tasks={tasks}` — replace:

```tsx
      <div className="space-y-5">
        <Bucket title="Picking Pending" tone="warn" items={picking} channelFor={channelFor} gatePassFor={gatePassFor} queued emptyText="Nothing pending right now." />
        <Bucket
          title="Gatepass generated — inventory blocked (WMS)"
          tone="info"
          items={blocked}
          channelFor={channelFor}
          gatePassFor={gatePassFor}
          emptyText="Nothing blocked in WMS right now."
          showAge
          createdAtFor={(f) => createdAtOf(f, tasks)}
          now={now}
        />
        <Bucket title="Not found — needs an alternate" tone="bad" items={exceptions} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing with a shortfall right now." />
        <Bucket title="Picking completed" tone="ok" items={done} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing completed yet." />
      </div>
```

with:

```tsx
      <div className="space-y-5">
        <Bucket title="Picking Pending" tone="warn" items={picking} channelFor={channelFor} gatePassFor={gatePassFor} queued emptyText="Nothing pending right now." families={families} tasks={tasks} />
        <Bucket
          title="Gatepass generated — inventory blocked (WMS)"
          tone="info"
          items={blocked}
          channelFor={channelFor}
          gatePassFor={gatePassFor}
          emptyText="Nothing blocked in WMS right now."
          showAge
          createdAtFor={(f) => createdAtOf(f, tasks)}
          now={now}
          families={families}
          tasks={tasks}
        />
        <Bucket title="Not found — needs an alternate" tone="bad" items={exceptions} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing with a shortfall right now." families={families} tasks={tasks} />
        <Bucket title="Picking completed" tone="ok" items={done} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing completed yet." families={families} tasks={tasks} />
      </div>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/roundHistoryInSupervisor.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full supervisor test suite**

Run: `npx vitest run tests/supervisor/`
Expected: PASS — all existing Supervisor tests (lazy-mount, age badge, search, needs-attention-list, WMS-blocked sort) plus this new file, all passing together with zero regressions.

- [ ] **Step 8: Commit**

```bash
git add src/components/SupervisorQueue.tsx tests/supervisor/roundHistoryInSupervisor.test.tsx
git commit -m "Show round-history tabs in Picking Supervisor, reusing RoundTabs from Repository"
```

---

### Task 6: De-emphasize the internal reference number

**Files:**
- Modify: `src/components/FacilityBlock.tsx`
- Test: `tests/supervisor/internalReferenceLabel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/supervisor/internalReferenceLabel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FacilityBlock } from "../../src/components/FacilityBlock";
import type { FacilityPicklist } from "../../src/lib/types";

function completedFacility(): FacilityPicklist {
  return {
    no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0,
    gp: "GP-133702", pickedTotal: 10, gatePassNo: "GPSLMH-REAL01",
    lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, picked: 10 }],
  };
}

describe("FacilityBlock — internal reference number", () => {
  it("labels the internal gp code as 'Internal ref:', not a bare 'Gatepass'", () => {
    render(<FacilityBlock f={completedFacility()} gatePassNo="GPSLMH-REAL01" />);
    expect(screen.getByText(/Internal ref:/)).toBeInTheDocument();
    expect(screen.getByText(/GP-133702/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/internalReferenceLabel.test.tsx`
Expected: FAIL — the text "Internal ref:" doesn't exist yet (current text is a bare "Gatepass GP-133702 ...").

- [ ] **Step 3: Implement**

In `src/components/FacilityBlock.tsx`, find:

```tsx
      {f.gp && (
        <div className="my-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          Gatepass {f.gp} · picked {f.pickedTotal}{f.bad ? ` · ${f.bad} not found` : ""}
        </div>
      )}
```

Replace with:

```tsx
      {f.gp && (
        <div className="my-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="font-normal text-emerald-600/70 dark:text-emerald-400/70">Internal ref:</span> {f.gp} · picked {f.pickedTotal}{f.bad ? ` · ${f.bad} not found` : ""}
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/internalReferenceLabel.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/components/FacilityBlock.tsx tests/supervisor/internalReferenceLabel.test.tsx
git commit -m "Label the internal gp tracking code as 'Internal ref:' to avoid confusion with the real gate pass"
```

---

### Task 7: Business Type filter (filter-only)

**Files:**
- Create: `src/lib/businessTypes.ts`
- Modify: `src/components/SupervisorQueue.tsx`
- Test: `tests/supervisor/businessTypes.test.ts`
- Test: `tests/supervisor/businessTypeFilter.test.tsx`

- [ ] **Step 1: Write the failing tests for the mapping helper**

Create `tests/supervisor/businessTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_UNMAPPED, BUSINESS_TYPES, businessTypeOf } from "../../src/lib/businessTypes";

describe("businessTypeOf", () => {
  it("maps a known channel to its business type", () => {
    expect(businessTypeOf("Amazon")).toBe("B2B Ecommerce + Q- Commerce");
  });

  it("maps a replenishment channel correctly", () => {
    expect(businessTypeOf("STN - MM")).toBe("Internal Stock Transfer - Warehouse - 3PL");
  });

  it("returns the unmapped marker for a channel not in the table", () => {
    expect(businessTypeOf("Some Brand New Channel Nobody Has Heard Of")).toBe(BUSINESS_TYPE_UNMAPPED);
  });
});

describe("BUSINESS_TYPES", () => {
  it("includes the unmapped marker as a selectable option", () => {
    expect(BUSINESS_TYPES).toContain(BUSINESS_TYPE_UNMAPPED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/businessTypes.test.ts`
Expected: FAIL — `src/lib/businessTypes.ts` doesn't exist yet.

- [ ] **Step 3: Create the mapping file**

Create `src/lib/businessTypes.ts`. This is the full mapping from `docs/superpowers/specs/2026-09-14-business-type-mapping.csv`, supplied by Vipul on 14 Sep 2026:

```ts
// Business Type mapping — a broader rollup of ~85 real channels, supplied by
// Vipul (see docs/superpowers/specs/2026-09-14-business-type-mapping.csv for
// the source data). Deliberately SEPARATE from CHANNEL_BUCKETS in
// channels.ts, which only covers ~30 channels and drives picklist-numbering
// prefixes (REPL-/B2BE-/B2BO-/GEN-). This mapping is filter-only: it does
// NOT replace CHANNEL_BUCKETS and does NOT change task numbering — see the
// 14 Sep 2026 design spec for why that was explicitly decided.
//
// Known gap (also noted in the spec): this table doesn't obviously cover
// every channel seen live in the app — e.g. a plain "Internal Stock
// Transfer - Warehouse" (distinct from the "-3PL"/"-Local" variants) and
// "Internal Stock Transfer - NCR" were observed live but aren't in the
// supplied table. Any channel not in this map reads as BUSINESS_TYPE_UNMAPPED
// rather than silently disappearing from the filter.
export const BUSINESS_TYPE_UNMAPPED = "Other / Unmapped";

export const BUSINESS_TYPE_BY_CHANNEL: Record<string, string> = {
  "Internal Stock Transfer - Warehouse - 3PL": "Internal Stock Transfer - Warehouse - 3PL",
  "Internal Stock Transfer - Warehouse - Local": "Internal Stock Transfer - Warehouse - Local",
  "Internal Stock Transfer - Dark Stores": "Internal Stock Transfer - Dark Stores",
  "STN - MM": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - BW": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - LJ": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - MP": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - Lucknow": "Internal Stock Transfer - Warehouse - 3PL",
  Amazon: "B2B Ecommerce + Q- Commerce",
  Flipkart: "B2B Ecommerce + Q- Commerce",
  "FK Hub": "B2B Ecommerce + Q- Commerce",
  Pillbox: "B2B Ecommerce + Q- Commerce",
  "RK World": "B2B Ecommerce + Q- Commerce",
  Myntra: "B2B Ecommerce + Q- Commerce",
  Nykaa: "B2B Ecommerce + Q- Commerce",
  Purplle: "B2B Ecommerce + Q- Commerce",
  Blinkit: "B2B Ecommerce + Q- Commerce",
  Zepto: "B2B Ecommerce + Q- Commerce",
  Instamart: "B2B Ecommerce + Q- Commerce",
  "Amazon Now": "B2B Ecommerce + Q- Commerce",
  Apollo: "B2B MT+ GT",
  "TATA 1MG": "B2B MT+ GT",
  "Wellness Forever": "B2B MT+ GT",
  "Health & Glow": "B2B MT+ GT",
  "Reliance Retail": "B2B MT+ GT",
  "BW Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Lucknow": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "MP BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "BW HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "MM HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "MP HYD": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B AHM Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B KOL Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B NCR Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "BLR B2B Offline": "Internal Stock Transfer - Warehouse - 3PL",
  TIRA: "B2B Ecommerce + Q- Commerce",
  "First club": "B2B Ecommerce + Q- Commerce",
  "STN DS": "Internal Stock Transfer - Dark Stores",
  "SL BW": "Internal Stock Transfer - Warehouse - Local",
  "SL MM": "Internal Stock Transfer - Warehouse - Local",
  "SL LJ": "Internal Stock Transfer - Warehouse - Local",
  Delhivery_Vadaplani: "Internal Stock Transfer - Dark Stores",
  DS_AHD: "Internal Stock Transfer - Dark Stores",
  DS_BLR: "Internal Stock Transfer - Dark Stores",
  DS_Hyd: "Internal Stock Transfer - Dark Stores",
  DS_Kol: "Internal Stock Transfer - Dark Stores",
  DTDC_Ernakulum: "Internal Stock Transfer - Dark Stores",
  ER_Jaipur: "Internal Stock Transfer - Dark Stores",
  Inamo_Chembur: "Internal Stock Transfer - Dark Stores",
  Inamo_MiraRoad: "Internal Stock Transfer - Dark Stores",
  Inamo_Sion: "Internal Stock Transfer - Dark Stores",
  MH_ER_BOM: "Internal Stock Transfer - Dark Stores",
  MH_PND_DELHI: "Internal Stock Transfer - Dark Stores",
  ER_Chennai: "Internal Stock Transfer - Dark Stores",
};

/** A channel not in the mapping reads as BUSINESS_TYPE_UNMAPPED rather than silently disappearing from the filter. */
export function businessTypeOf(channel: string): string {
  return BUSINESS_TYPE_BY_CHANNEL[channel] ?? BUSINESS_TYPE_UNMAPPED;
}

export const BUSINESS_TYPES: string[] = [
  "Internal Stock Transfer - Warehouse - 3PL",
  "Internal Stock Transfer - Warehouse - Local",
  "Internal Stock Transfer - Dark Stores",
  "B2B Ecommerce + Q- Commerce",
  "B2B MT+ GT",
  BUSINESS_TYPE_UNMAPPED,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/businessTypes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for the filter wiring**

Create `tests/supervisor/businessTypeFilter.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SupervisorQueue } from "../../src/components/SupervisorQueue";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();

afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function task(no: string, channel: string): PickingTask {
  return {
    no,
    channel,
    demand: [],
    shortfall: [],
    createdAt: "2026-09-13T00:00:00Z",
    facilities: [
      {
        no: `${no}-MH`,
        taskNo: no,
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: `GP-${no}`,
        createdAt: "2026-09-13T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
      },
    ],
  };
}

describe("SupervisorQueue — Business Type filter", () => {
  it("narrows the queue to only picklists whose channel maps to the selected business type", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [task("AMAZON-ORDER", "Amazon"), task("STN-ORDER", "STN - MM")],
    });
    render(<SupervisorQueue />);

    expect(screen.getByText(/GP-AMAZON-ORDER/)).toBeInTheDocument();
    expect(screen.getByText(/GP-STN-ORDER/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/business type/i), "B2B Ecommerce + Q- Commerce");

    expect(screen.getByText(/GP-AMAZON-ORDER/)).toBeInTheDocument();
    expect(screen.queryByText(/GP-STN-ORDER/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/businessTypeFilter.test.tsx`
Expected: FAIL — no element labeled "business type" exists yet.

- [ ] **Step 7: Wire the filter into `SupervisorQueue`**

In `src/components/SupervisorQueue.tsx`, add to the imports:

```tsx
import { BUSINESS_TYPES, businessTypeOf } from "../lib/businessTypes";
```

Add filter state alongside the other `useState` calls inside `SupervisorQueue`:

```tsx
  const [businessTypeFilter, setBusinessTypeFilter] = useState("");
```

Add the predicate into the `filtered` computation — replace:

```tsx
  const filtered = all.filter((f) => {
    if (facilityFilter && f.facility !== facilityFilter) return false;
    if (channelFilter && channelFor(f) !== channelFilter) return false;
    if (pickerFilter && !f.lines.some((l) => l.picker === pickerFilter)) return false;
    if (!inAgeingRange(createdAtOf(f, tasks), ageingRange)) return false;
    if (!matchesSupervisorSearch(f, channelFor(f), gatePassFor(f), searchQuery)) return false;
    return true;
  });
```

with:

```tsx
  const filtered = all.filter((f) => {
    if (facilityFilter && f.facility !== facilityFilter) return false;
    if (channelFilter && channelFor(f) !== channelFilter) return false;
    if (pickerFilter && !f.lines.some((l) => l.picker === pickerFilter)) return false;
    if (businessTypeFilter && businessTypeOf(channelFor(f)) !== businessTypeFilter) return false;
    if (!inAgeingRange(createdAtOf(f, tasks), ageingRange)) return false;
    if (!matchesSupervisorSearch(f, channelFor(f), gatePassFor(f), searchQuery)) return false;
    return true;
  });
```

Add the dropdown into the filter row — replace the closing of the picker `<select>` and the `</div>` right after it:

```tsx
        <select value={pickerFilter} onChange={(e) => setPickerFilter(e.target.value)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="">All pickers</option>
          {pickers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
```

with:

```tsx
        <select value={pickerFilter} onChange={(e) => setPickerFilter(e.target.value)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="">All pickers</option>
          {pickers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Business type"
          value={businessTypeFilter}
          onChange={(e) => setBusinessTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">All business types</option>
          {BUSINESS_TYPES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/businessTypeFilter.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 9: Run the full supervisor suite**

Run: `npx vitest run tests/supervisor/`
Expected: PASS — every supervisor test file, zero regressions.

- [ ] **Step 10: Commit**

```bash
git add src/lib/businessTypes.ts src/components/SupervisorQueue.tsx tests/supervisor/businessTypes.test.ts tests/supervisor/businessTypeFilter.test.tsx
git commit -m "Add Business Type filter (filter-only, doesn't touch task numbering)"
```

---

### Task 8: Full test suite + build + live verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — every existing test plus every new file added across Tasks 1–7, zero regressions.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS — `tsc -b` (strict mode) + `vite build` both succeed, no type errors from the new `reofferedFrom` field, the new `RoundTabs`/`businessTypes` modules, or the changed component prop signatures.

- [ ] **Step 3: Verify live against the dev server**

Start the dev server (`npm run dev`), open both **Picking Supervisor** and **Picklist Repository** as a Supervisor/Admin role, and confirm:
- Picking Supervisor: the 4 stage buckets look exactly as before, plus a new Business Type dropdown and 3 new date-preset buttons (Yesterday -2/-3/-4) in the filter row.
- Find (or create, via a not-found pick) a picklist with at least one re-offer round. Confirm its card shows round tabs, defaulting to "Original," and that clicking "Round 2" (or later) switches the displayed facility/gate pass/lines to that round's own data.
- Picklist Repository: confirm it now also defaults to showing "Original" first (not the latest round) when you open a multi-round family's card.
- Any completed picklist showing the internal tracking code now reads "Internal ref: GP-xxxxxx" instead of a bare "Gatepass GP-xxxxxx."
- No console errors.

- [ ] **Step 4: Commit if any fixes were needed during live verification**

```bash
git add -A
git commit -m "Fix issues found during live verification of filters + round history"
```

(Only commit if Step 3 actually required a code change — if verification passed clean, there's nothing to commit here.)

---

## Self-Review Notes

- **Spec coverage:** date presets ✓ (Task 1), `reofferedFrom` ✓ (Task 2), `groupPicklistFamilies` chain-following ✓ (Task 3), shared `RoundTabs` + Repository default fix ✓ (Task 4), Supervisor round history ✓ (Task 5), internal reference de-emphasis ✓ (Task 6), Business Type filter ✓ (Task 7). Facility filter and Status-via-buckets were explicitly unchanged per the spec, so no task touches them.
- **Placeholder scan:** no TBD/TODO — every step has complete, runnable code, including the full ~78-row Business Type mapping (no "...rest of the table" shortcuts).
- **Type consistency:** `reofferedFrom?: string` (Task 2's `types.ts` addition) is the exact name/type used by Task 3's `groupPicklistFamilies` and Task 2's own `buildFacilityLists` stamp. `familyFor(f, families)` signature (Task 3) matches its Task 5 call site exactly. `RoundTabs`'s props (`family`, `selectedRound`, `onSelectRound`) match between its Task 4 definition and both Task 4's (Repository) and Task 5's (Supervisor) call sites. `businessTypeOf`/`BUSINESS_TYPES` (Task 7) match between definition and Supervisor's usage.
