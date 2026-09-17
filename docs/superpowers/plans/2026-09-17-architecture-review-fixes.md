# Architecture Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 14 findings from the architecture review conducted on the FEFO Smart Picking codebase (3 Critical, 5 High, 3 Medium, 3 Low), each with a real, verified reproduction of the failure and a minimal fix.

**Architecture:** No new subsystems. This plan tightens existing patterns already proven correct elsewhere in the codebase — the `saveOwnFacilityChanges`/`mergeOwnChangesOntoFreshTask` concurrent-safe save mechanism, the `holdKey`-based stable-lot-identity pattern, and PostgREST pagination already used by `fetchStock` — and applies each to the places that still bypass them.

**Tech Stack:** TypeScript, Zustand, Supabase (Postgres + Realtime + PostgREST), Vitest + Testing Library.

**Sequencing:** Tasks 1-8 (Critical) touch the same core of `store.ts` and should land first, in order — Task 3 (`saveTaskFlag`) is a dependency of Task 8. Tasks 9-21 are independent of each other and of 1-8, except Task 15 (which assumes the identity-based exclusion already merged as part of PR #12 and further consolidates it) and Task 18 (which assumes Tasks 1-8's `saveOwnFacilityChanges` pattern is in place). **Task 17 is explicitly blocked** on a decision from Vipul and must not be executed as part of an "apply the whole plan" run.

---

## Critical

### Task 1: Stop `flushOfflineQueue` from silently discarding queued picks

A picker's device that loses connectivity mid-pick queues the result locally (`enqueuePick`) and reports "will sync once you're back online." Today, `flushOfflineQueue` (`src/lib/store.ts:1374-1411`) looks up the facility in the CURRENT in-memory `tasks` and just re-saves whatever it finds — but after any reload, `tasks` is freshly re-fetched from Supabase (which never received the offline pick), so the queued `results` are never actually re-applied anywhere. The function then dequeues the entry and reports "✓ Synced" even though nothing was saved. Confirmed live: `App.tsx:202-209` fires `loadTasks()` and `flushOfflineQueue()` unawaited in the same effect, and `partialize` (`store.ts` — search `tasks: isSupabaseConfigured`) wipes `tasks` from localStorage whenever Supabase is configured (always true here), so there is nothing left in this browser, after a reload, that remembers the pick.

Also: `QueuedPick` (`src/lib/offlineQueue.ts`) only stores `{facilityNo, results}` — the not-found *reason* and *who picked it* are never queued at all, so even a naive fix that "reapplies `results`" would still lose the reason text.

**Fix shape:** store `reasons` and `heldBy` alongside `results` in the queue, and have `flushOfflineQueue` re-invoke the real `applyPicks` action for each queued item (not a hand-rolled partial reimplementation) — `applyPicks` already contains the exact correct logic for resolving lines, completing a facility, generating round-2 re-offers, stamping gate passes, and placing holds, and `resolvePickLine`'s existing "already resolved, no-op" guard (`store.ts` — search `function resolvePickLine`) makes it safe to call twice on the same line. Also gate the whole function on `tasksLoaded` so it never runs before `loadTasks()` has populated real data.

**Files:**
- Modify: `src/lib/offlineQueue.ts` (the `QueuedPick` interface and `enqueue` function)
- Modify: `src/lib/store.ts:1366` (the `enqueuePick({ facilityNo, results })` call inside `applyPicks`'s catch block)
- Modify: `src/lib/store.ts:1374-1411` (`flushOfflineQueue`)
- Test: `tests/demand/flushOfflineQueueReplaysResults.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask, StockRow } from "../../src/lib/types";

// Real gap: a picker's device goes offline mid-pick, applyPicks queues the
// result (enqueuePick) since the Supabase save fails. Before the queue is
// ever flushed, the browser reloads — `tasks` is now a freshly-refetched,
// still-UNPICKED copy from Supabase (the earlier local resolution was never
// persisted anywhere; partialize wipes `tasks` from localStorage whenever
// Supabase is configured). The old flushOfflineQueue just re-saved that
// fresh unpicked task and dequeued the entry, reporting "✓ Synced" while
// silently discarding the picker's actual results.
vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("flushOfflineQueue — replays queued pick results instead of dropping them", () => {
  afterEach(() => vi.resetModules());

  it("applies the queued not-found result onto a freshly-reloaded (still-unpicked) task before saving", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const { enqueue, loadQueue } = await import("../../src/lib/offlineQueue");
    const initialState = useStore.getState();

    const freshTask: PickingTask = {
      no: "TASK-OFFLINE",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-OFF", qty: 10, gatePassNo: "GP-OFF" }],
      facilities: [
        {
          no: "TASK-OFFLINE-MH", taskNo: "TASK-OFFLINE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-OFF",
          lines: [{ rid: 501, sku: "SKU-OFF", name: "Offline product", facility: "SL Mother Hub", bin: "M1", batch: "B1", exp: [2099, 1], rem: 900, qty: 10 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };

    // Simulates post-reload state: tasks freshly reloaded from Supabase
    // (nothing knows about this device's unsynced pick yet), and the pick
    // is sitting in the offline queue from before the reload.
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshTask);
    useStore.setState({
      tasks: [freshTask],
      tasksLoaded: true,
      stock: [{ rid: 501, location: "SL Mother Hub", bin: "M1", sku: "SKU-OFF", name: "Offline product", batch: "B1", exp: [2099, 1], qty: 10, shelf: 24, type: "Good", active: "Active" }],
      skus: { "SKU-OFF": { name: "Offline product", shelf: 24 } },
    });

    enqueue({ facilityNo: "TASK-OFFLINE-MH", results: { 501: 3 }, reasons: { 501: "Damaged stock" }, heldBy: "Night Picker" });

    await useStore.getState().flushOfflineQueue();

    const savedTask = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    expect(savedTask).toBeDefined();
    const savedLine = savedTask.facilities[0].lines[0];
    expect(savedLine.picked).toBe(7);
    expect(savedLine.nf).toBe(3);
    expect(savedLine.nfReason).toBe("Damaged stock");
    expect(loadQueue()).toHaveLength(0);

    useStore.setState(initialState, true);
  });

  it("does not run before loadTasks has populated real data (tasksLoaded gate)", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const { enqueue } = await import("../../src/lib/offlineQueue");
    const initialState = useStore.getState();

    useStore.setState({ tasks: [], tasksLoaded: false });
    enqueue({ facilityNo: "TASK-COLD-START-MH", results: { 1: 0 }, reasons: {}, heldBy: "Tester" });

    await useStore.getState().flushOfflineQueue();

    // Must not have tried to save anything, and must not have silently
    // dropped the queued item just because tasks was still empty.
    expect(tasksSupabase.updateTaskData).not.toHaveBeenCalled();
    const { loadQueue } = await import("../../src/lib/offlineQueue");
    expect(loadQueue()).toHaveLength(1);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/flushOfflineQueueReplaysResults.test.ts`
Expected: FAIL — first test fails because `savedLine.picked`/`nf` come back `undefined` (the old code never reapplies `results` to the fresh task) or `updateTaskData` is never called at all (the old code just dequeues after finding a facility whose fresh copy has no picks). Second test fails because `enqueue` doesn't accept `reasons`/`heldBy` yet and/or the old code has no `tasksLoaded` gate and calls `updateTaskData` regardless.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/offlineQueue.ts`, replace the `QueuedPick` interface and `enqueue`:

```ts
export interface QueuedPick {
  id: string;
  facilityNo: string;
  results: Record<number, number>;
  reasons: Record<number, string>;
  heldBy: string;
  queuedAt: string;
}

export function loadQueue(): QueuedPick[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedPick[]) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedPick[]): void {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export function enqueue(item: { facilityNo: string; results: Record<number, number>; reasons: Record<number, string>; heldBy: string }): QueuedPick {
  const queued: QueuedPick = { ...item, id: `${item.facilityNo}-${Date.now()}`, queuedAt: new Date().toISOString() };
  save([...loadQueue(), queued]);
  return queued;
}
```

In `src/lib/store.ts`, update the `applyPicks` catch block (around line 1366) to pass the extra fields:

```ts
          } catch {
            // Offline or a transient failure — the pick is already applied
            // locally above; queue the sync so it isn't silently lost.
            enqueuePick({ facilityNo, results, reasons, heldBy: heldBy || "Unknown" });
            const offlineMsg = "⚠ Saved on this device — will sync once you're back online.";
            const priorNotice = get().notice;
            set({ notice: priorNotice.startsWith("Could not place hold") ? `${priorNotice} Also: ${offlineMsg}` : offlineMsg });
          }
```

Replace `flushOfflineQueue` (lines 1374-1411) entirely:

```ts
      flushOfflineQueue: async () => {
        if (!isSupabaseConfigured || !get().tasksLoaded) return;
        const queue = loadPickQueue();
        const gpQueue = loadGatePassQueue();
        if (queue.length === 0 && gpQueue.length === 0) return;
        for (const item of queue) {
          // Remove the old entry before retrying — applyPicks' own catch
          // block re-queues a fresh entry if this retry also fails, so
          // nothing is lost either way, and there's no leftover stale
          // duplicate sitting alongside a new one.
          dequeuePick(item.id);
          await get().applyPicks(item.facilityNo, item.results, item.reasons, item.heldBy);
        }
        for (const item of gpQueue) {
          const task = get().tasks.find((t) => t.no === item.taskNo);
          if (!task) {
            dequeueGatePass(item.id);
            continue;
          }
          try {
            await saveOwnFacilityChanges(task, new Set([item.facilityNo]));
            dequeueGatePass(item.id);
          } catch {
            // Still offline / still failing — leave it queued for next time.
          }
        }
        if (loadPickQueue().length === 0 && loadGatePassQueue().length === 0) set({ notice: "✓ Synced queued update(s)." });
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/flushOfflineQueueReplaysResults.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/offlineQueue.ts src/lib/store.ts tests/demand/flushOfflineQueueReplaysResults.test.ts
git commit -m "fix: replay queued offline picks through applyPicks instead of silently dropping them"
```

---

### Task 2: Fix stock deduction matching by volatile `rid` instead of stable lot identity

`applyPicks` (`src/lib/store.ts:1177-1190`) deducts picked quantity by `stock.find((x) => x.rid === l.rid)`. `rid` is a plain positional counter reassigned fresh on every stock resync (`src/lib/sampleData.ts`, `rowsFromTuples`: `let rid = 0; ... rid: ++rid`) — it has no relationship to a physical lot's identity across syncs. A picklist line created on one device/sync can carry a `rid` that, by the time it's completed (possibly by a different device, or after this device's own later resync), matches a completely different, unrelated stock row — sometimes at a different facility. The deduction then silently zeroes out the wrong lot while leaving the actually-picked lot's quantity untouched. This corrupts the stock feeding the round-2 re-offer engine two lines later in the same function, corrupts `holdsToCreate`'s hold quantities (which assume `stock` already reflects the real deduction — see `src/lib/holds.ts` doc comment above `holdsToCreate`), and can cause `checkHoldAutoRelease` to spuriously release an unrelated hold when its lot gets wrongly zeroed.

**Fix shape:** match by `holdKey(sku, facility, bin, batch)` — the same stable-identity pattern already used by `reservedFor`, `allocate()`'s `heldKeys` check, and the not-found re-offer exclusion (see Task 15).

**Files:**
- Modify: `src/lib/store.ts:1177-1190`
- Test: `tests/demand/stockDeductionByStaleRid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// LOT-A is the lot this picklist line is actually about (same sku/facility/
// bin/batch), but its remembered rid (999) is stale — a resync since this
// line was created reassigned rid 999 to a completely unrelated lot,
// LOT-B, at a different facility. Real production risk: picklists are
// generated on one device's stock snapshot and completed on another's.
function stock(): StockRow[] {
  return [
    { rid: 501, location: "SL Mother Hub", bin: "M1", sku: "SKU-DED", name: "Product DED", batch: "BATCH-A", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 999, location: "SL RX", bin: "R1", sku: "SKU-UNRELATED", name: "Unrelated product", batch: "BATCH-U", exp: [2099, 1], qty: 15, shelf: 24, type: "Good", active: "Active" },
  ];
}

function task(): PickingTask {
  return {
    no: "TASK-DED",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-DED", qty: 8, gatePassNo: "GP-DED" }],
    facilities: [
      {
        no: "TASK-DED-MH", taskNo: "TASK-DED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-DED",
        // rid 999 is stale — the line really refers to LOT-A (Mother Hub /
        // M1 / BATCH-A), but its remembered rid now matches LOT-B's current rid.
        lines: [{ rid: 999, sku: "SKU-DED", name: "Product DED", facility: "SL Mother Hub", bin: "M1", batch: "BATCH-A", exp: [2099, 1], rem: 900, qty: 8 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("applyPicks — stock deduction matches by lot identity, not stale rid", () => {
  it("deducts from the lot the line actually refers to, and leaves the unrelated rid-colliding lot untouched", async () => {
    useStore.setState({ stock: stock(), skus: { "SKU-DED": { name: "Product DED", shelf: 24 } }, tasks: [task()] });

    await useStore.getState().applyPicks("TASK-DED-MH", { 999: 0 }, {}, "Tester");

    const updatedStock = useStore.getState().stock;
    const lotA = updatedStock.find((b) => b.bin === "M1" && b.batch === "BATCH-A")!;
    const lotB = updatedStock.find((b) => b.bin === "R1" && b.batch === "BATCH-U")!;

    expect(lotA.qty).toBe(12); // 20 - 8 picked, deducted from the RIGHT lot
    expect(lotB.qty).toBe(15); // untouched — the rid collision must not affect it
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/stockDeductionByStaleRid.test.ts`
Expected: FAIL — `lotA.qty` comes back `20` (untouched) and `lotB.qty` comes back `7` (wrongly deducted), since the old code matches `stock.find(x => x.rid === l.rid)` and finds LOT-B (rid 999) instead of LOT-A.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`, replace lines 1177-1190:

```ts
        let tasks = state.tasks.map((t) => ({
          ...t,
          facilities: t.facilities.map((f) => {
            if (f.no !== facilityNo) return f;
            const lines = f.lines.map((l) => {
              const resolved = resolvePickLine(l, results, reasons);
              if (resolved === l) return l;
              const key = holdKey(l.sku, l.facility, l.bin, l.batch);
              const b = stock.find((x) => holdKey(x.sku, x.location, x.bin, x.batch) === key);
              if (b) b.qty = Math.max(0, b.qty - resolved.picked!);
              return resolved;
            });
            return { ...f, lines };
          }),
        }));
```

(`holdKey` is already imported at the top of `store.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/stockDeductionByStaleRid.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/stockDeductionByStaleRid.test.ts
git commit -m "fix: deduct picked stock by sku+facility+bin+batch identity instead of volatile rid"
```

---

### Task 3: Introduce `saveTaskFlag` for task-level (non-facility) safe saves

Two shapes of unsafe write exist in `store.ts`: writes that own one specific facility's data (already solved by the existing `saveOwnFacilityChanges`), and writes that only touch a task-LEVEL field (`archived`) with no facility ownership concept — `mergeOwnChangesOntoFreshTask` only merges `facilities`/`shortfall`/`binSkips`, nothing at the task's own top level. Task 3 adds the missing helper; Tasks 4-8 use it (and the existing `saveOwnFacilityChanges`) to fix all 13 unsafe call sites identified in the review.

**Files:**
- Modify: `src/lib/store.ts` (add `saveTaskFlag` near `saveOwnFacilityChanges`, around line 519)
- Test: `tests/demand/saveTaskFlagConcurrentSafety.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("saveTaskFlag — task-level field save survives a concurrent facility change", () => {
  afterEach(() => vi.resetModules());

  it("applies the flag on top of the freshest server copy, not this device's possibly-stale local copy", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const local: PickingTask = {
      no: "TASK-FLAG",
      channel: CHANNEL,
      demand: [],
      facilities: [
        { no: "TASK-FLAG-MH", taskNo: "TASK-FLAG", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
      archived: false,
    };
    // Someone else completed MH, in Supabase, in the moments since this
    // device last read the task.
    const freshFromServer: PickingTask = { ...local, facilities: [{ ...local.facilities[0], status: "completed", pickedTotal: 3, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);

    const storeModule = await import("../../src/lib/store");
    await storeModule.saveTaskFlagForTest(local, { archived: true });

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    expect(saved.archived).toBe(true); // the flag this call owns went through
    expect(saved.facilities[0].status).toBe("completed"); // the other device's completion survived
    expect(saved.facilities[0].pickedTotal).toBe(3);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/saveTaskFlagConcurrentSafety.test.ts`
Expected: FAIL — `storeModule.saveTaskFlagForTest` is not a function (doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`, add right after `mergeOwnChangesOntoFreshTask` (after line 519, before `saveOwnFacilityChanges`):

```ts
/**
 * Same "fetch fresh, don't trust local" principle as saveOwnFacilityChanges,
 * for fields that live on the TASK itself (e.g. `archived`) rather than
 * inside any one facility — there's no ownFacilityNos concept to merge by,
 * so this just fetches fresh and layers the patch on top of it. Falls back
 * to `local` if the fresh fetch comes back empty, same as
 * saveOwnFacilityChanges — no worse than the old behavior in that case.
 */
async function saveTaskFlag(local: PickingTask, patch: Partial<Pick<PickingTask, "archived">>): Promise<void> {
  const fresh = await fetchTaskByNo(local.no);
  await updateTaskData(fresh ? { ...fresh, ...patch } : { ...local, ...patch });
}

// Test-only export — saveTaskFlag itself stays module-private like
// saveOwnFacilityChanges, this just gives tests a way to call it directly.
export const saveTaskFlagForTest = saveTaskFlag;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/saveTaskFlagConcurrentSafety.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/saveTaskFlagConcurrentSafety.test.ts
git commit -m "feat: add saveTaskFlag helper for concurrent-safe task-level field saves"
```

---

### Task 4: Route `assignAll`, `assignLine`, `uploadAssignments` through `saveOwnFacilityChanges`

All three touch exactly one facility (`facilityNo`) and already compute a `changed: PickingTask` local copy — identical fix shape to `setFacilityGatePass` (`store.ts:1592-1627`), which already does this correctly.

**Files:**
- Modify: `src/lib/store.ts:1109-1170` (`assignAll`, `assignLine`, `uploadAssignments`)
- Test: `tests/demand/assignmentSavesSurviveConcurrentCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function baseTask(): PickingTask {
  return {
    no: "TASK-ASSIGN",
    channel: CHANNEL,
    demand: [],
    facilities: [
      { no: "TASK-ASSIGN-MH", taskNo: "TASK-ASSIGN", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [{ rid: 1, sku: "SKU-A", name: "A", facility: "SL Mother Hub", bin: "M1", batch: "B1", exp: [2099, 1], rem: 900, qty: 5 }] },
      { no: "TASK-ASSIGN-AMB", taskNo: "TASK-ASSIGN", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [] },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("assignAll — survives a sibling facility completed by someone else in the meantime", () => {
  afterEach(() => vi.resetModules());

  it("does not clobber the Ambient facility's completion when assigning Mother Hub", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const local = baseTask();
    const freshFromServer: PickingTask = { ...local, facilities: [local.facilities[0], { ...local.facilities[1], status: "completed", pickedTotal: 4, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [local] });

    await useStore.getState().assignAll("TASK-ASSIGN-MH", "Mohd Faiz");

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedAmb = saved.facilities.find((f) => f.no === "TASK-ASSIGN-AMB");
    expect(savedAmb?.status).toBe("completed");
    expect(savedAmb?.pickedTotal).toBe(4);
    const savedMh = saved.facilities.find((f) => f.no === "TASK-ASSIGN-MH");
    expect(savedMh?.lines[0].picker).toBe("Mohd Faiz");

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/assignmentSavesSurviveConcurrentCompletion.test.ts`
Expected: FAIL — `tasksSupabase.fetchTaskByNo` is never called (old code calls raw `updateTaskData(changed)` with this device's stale local copy, so `savedAmb.status` comes back `"open"`, not `"completed"`).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`, change the tail of all three actions (lines ~1109-1170) from `if (isSupabaseConfigured && changed) await updateTaskData(changed);` to:

```ts
        if (isSupabaseConfigured && changed) await saveOwnFacilityChanges(changed, new Set([facilityNo]));
```

(Same one-line change in `assignAll`, `assignLine`, and `uploadAssignments` — each already has `changed` and `facilityNo` in scope.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/assignmentSavesSurviveConcurrentCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/assignmentSavesSurviveConcurrentCompletion.test.ts
git commit -m "fix: save assignAll/assignLine/uploadAssignments through saveOwnFacilityChanges"
```

---

### Task 5: Route `discardFacilityPicklist`, `undiscardFacilityPicklist`, `revokeWmsBlock` through `saveOwnFacilityChanges`

Same single-facility-ownership shape as Task 4.

**Files:**
- Modify: `src/lib/store.ts:1541-1590` (`discardFacilityPicklist`, `undiscardFacilityPicklist`)
- Modify: `src/lib/store.ts:1629-1642` (`revokeWmsBlock`)
- Test: `tests/demand/discardAndRevokeSavesSurviveConcurrentCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function baseTask(): PickingTask {
  return {
    no: "TASK-DISCARD",
    channel: CHANNEL,
    demand: [],
    facilities: [
      { no: "TASK-DISCARD-MH", taskNo: "TASK-DISCARD", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] },
      { no: "TASK-DISCARD-AMB", taskNo: "TASK-DISCARD", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [] },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("discardFacilityPicklist — survives a sibling facility completed by someone else in the meantime", () => {
  afterEach(() => vi.resetModules());

  it("does not clobber the Ambient facility's completion when discarding Mother Hub", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const local = baseTask();
    const freshFromServer: PickingTask = { ...local, facilities: [local.facilities[0], { ...local.facilities[1], status: "completed", pickedTotal: 2, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [local] });

    await useStore.getState().discardFacilityPicklist("TASK-DISCARD", "TASK-DISCARD-MH", "Tester");

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedAmb = saved.facilities.find((f) => f.no === "TASK-DISCARD-AMB");
    expect(savedAmb?.status).toBe("completed");
    expect(savedAmb?.pickedTotal).toBe(2);
    const savedMh = saved.facilities.find((f) => f.no === "TASK-DISCARD-MH");
    expect(savedMh?.discarded).toBe(true);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/discardAndRevokeSavesSurviveConcurrentCompletion.test.ts`
Expected: FAIL — `savedAmb.status` comes back `"open"` (old code pushes the stale local `updated`, clobbering Ambient's completion).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`:

Line 1580, inside `discardFacilityPicklist`, replace:
```ts
        if (isSupabaseConfigured) await updateTaskData(updated);
```
with:
```ts
        if (isSupabaseConfigured) await saveOwnFacilityChanges(updated, new Set([facilityNo]));
```

Line 1589, inside `undiscardFacilityPicklist`, same replacement.

Line 1641, inside `revokeWmsBlock`, same replacement.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/discardAndRevokeSavesSurviveConcurrentCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/discardAndRevokeSavesSurviveConcurrentCompletion.test.ts
git commit -m "fix: save discard/undiscard/revokeWmsBlock through saveOwnFacilityChanges"
```

---

### Task 6: Make `checkWmsAutoBlock`'s automatic 60-second sweep concurrent-safe

`checkWmsAutoBlock` (`store.ts:1644-1661`) runs on every open device every 60 seconds (`App.tsx:219`, started before the picker-role early return), stamping `wmsBlocked: true` on facilities across potentially many tasks and pushing each whole task via raw `updateTaskData(t)`. This is the highest-risk of the 13 sites because it's automatic and silent — no user action triggers it, so a wiped completion here has no obvious cause for anyone to trace.

**Files:**
- Modify: `src/lib/store.ts:1644-1661`
- Test: `tests/demand/wmsAutoBlockSweepSurvivesConcurrentCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("checkWmsAutoBlock — the automatic sweep survives a sibling facility completed by someone else", () => {
  afterEach(() => vi.resetModules());

  it("does not clobber Ambient's completion while WMS-blocking Mother Hub in the same sweep", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago, past WMS_BLOCK_DELAY_MS
    const local: PickingTask = {
      no: "TASK-SWEEP",
      channel: CHANNEL,
      demand: [],
      facilities: [
        { no: "TASK-SWEEP-MH", taskNo: "TASK-SWEEP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [], createdAt, gatePassNo: "GP-SWEEP-MH" },
        { no: "TASK-SWEEP-AMB", taskNo: "TASK-SWEEP", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [], createdAt, gatePassNo: "GP-SWEEP-AMB" },
      ],
      shortfall: [],
      createdAt,
    };
    const freshFromServer: PickingTask = { ...local, facilities: [local.facilities[0], { ...local.facilities[1], status: "completed", pickedTotal: 6, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [local] });

    await useStore.getState().checkWmsAutoBlock();

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedAmb = saved.facilities.find((f) => f.no === "TASK-SWEEP-AMB");
    expect(savedAmb?.status).toBe("completed");
    expect(savedAmb?.pickedTotal).toBe(6);
    const savedMh = saved.facilities.find((f) => f.no === "TASK-SWEEP-MH");
    expect(savedMh?.wmsBlocked).toBe(true);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/wmsAutoBlockSweepSurvivesConcurrentCompletion.test.ts`
Expected: FAIL — `savedAmb.status` comes back `"open"`, since the old sweep pushes each whole stale local task via `updateTaskData(t)`.

- [ ] **Step 3: Write minimal implementation**

Replace `checkWmsAutoBlock` (lines 1644-1661) in `src/lib/store.ts`:

```ts
      checkWmsAutoBlock: async () => {
        const due = dueForWmsBlock(get().tasks);
        if (due.length === 0) return;
        const dueKeys = new Set(due.map((f) => f.no));
        const now = new Date().toISOString();
        const touched: { task: PickingTask; facilityNos: Set<string> }[] = [];
        let tasks = get().tasks.map((t) => {
          const ownFacilityNos = new Set(t.facilities.filter((f) => dueKeys.has(f.no)).map((f) => f.no));
          if (ownFacilityNos.size === 0) return t;
          const next = { ...t, facilities: t.facilities.map((f) => (dueKeys.has(f.no) ? { ...f, wmsBlocked: true, wmsBlockedAt: now } : f)) };
          touched.push({ task: next, facilityNos: ownFacilityNos });
          return next;
        });
        set({ tasks });
        if (isSupabaseConfigured) {
          for (const { task, facilityNos } of touched) await saveOwnFacilityChanges(task, facilityNos);
        }
        if (!get().anyOpen()) void get().loadFromSupabase();
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/wmsAutoBlockSweepSurvivesConcurrentCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/wmsAutoBlockSweepSurvivesConcurrentCompletion.test.ts
git commit -m "fix: make the automatic WMS-block sweep concurrent-safe across devices"
```

---

### Task 7: Route `renamePicker`'s per-task saves through `saveOwnFacilityChanges`

`renamePicker` (`store.ts:770-804`) can touch multiple facilities within one task (every facility that has a line assigned to the renamed picker), then pushes each affected task whole via raw `updateTaskData(t)`.

**Files:**
- Modify: `src/lib/store.ts:770-804`
- Test: `tests/demand/renamePickerSurvivesConcurrentCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});
vi.mock("../../src/lib/pickersSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/pickersSupabase")>();
  return { ...actual, renamePickerRow: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("renamePicker — survives a sibling facility completed by someone else in the meantime", () => {
  afterEach(() => vi.resetModules());

  it("does not clobber Ambient's completion while renaming a picker on Mother Hub's lines", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const local: PickingTask = {
      no: "TASK-RENAME",
      channel: CHANNEL,
      demand: [],
      facilities: [
        { no: "TASK-RENAME-MH", taskNo: "TASK-RENAME", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [{ rid: 1, sku: "SKU-R", name: "R", facility: "SL Mother Hub", bin: "M1", batch: "B1", exp: [2099, 1], rem: 900, qty: 3, picker: "Old Name" }] },
        { no: "TASK-RENAME-AMB", taskNo: "TASK-RENAME", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [] },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    const freshFromServer: PickingTask = { ...local, facilities: [local.facilities[0], { ...local.facilities[1], status: "completed", pickedTotal: 1, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [local], pickers: ["Old Name"] });

    await useStore.getState().renamePicker("Old Name", "New Name");

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedAmb = saved.facilities.find((f) => f.no === "TASK-RENAME-AMB");
    expect(savedAmb?.status).toBe("completed");
    expect(savedAmb?.pickedTotal).toBe(1);
    const savedMh = saved.facilities.find((f) => f.no === "TASK-RENAME-MH");
    expect(savedMh?.lines[0].picker).toBe("New Name");

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/renamePickerSurvivesConcurrentCompletion.test.ts`
Expected: FAIL — `savedAmb.status` comes back `"open"`.

- [ ] **Step 3: Write minimal implementation**

Replace the tail of `renamePicker` (from `const affected = ...` through the end, lines 782-804) in `src/lib/store.ts`:

```ts
        const affected = get().tasks.filter((t) => t.facilities.some((f) => f.lines.some((l) => l.picker === oldName)));
        let tasks = get().tasks;
        const touched: { task: PickingTask; facilityNos: Set<string> }[] = [];
        for (const t of affected) {
          const facilityNos = new Set(t.facilities.filter((f) => f.lines.some((l) => l.picker === oldName)).map((f) => f.no));
          const updated: PickingTask = {
            ...t,
            facilities: t.facilities.map((f) => ({
              ...f,
              lines: f.lines.map((l) => (l.picker === oldName ? { ...l, picker: trimmed } : l)),
            })),
          };
          tasks = mergeTask(tasks, updated);
          touched.push({ task: updated, facilityNos });
        }
        set({ tasks });
        if (isSupabaseConfigured) {
          for (const { task, facilityNos } of touched) {
            try {
              await saveOwnFacilityChanges(task, facilityNos);
            } catch (e) {
              set({ notice: "Could not rename picker on " + task.no + ": " + (e as Error).message });
            }
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/renamePickerSurvivesConcurrentCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/renamePickerSurvivesConcurrentCompletion.test.ts
git commit -m "fix: save renamePicker's per-task changes through saveOwnFacilityChanges"
```

---

### Task 8: Route `archiveTask`, `unarchiveTask`, `archiveAllActiveTasks`, `unarchiveAllTasks`, `archiveByCutoff` through `saveTaskFlag`

Five actions flip the task-level `archived` boolean via raw `updateTaskData`. Uses the `saveTaskFlag` helper from Task 3.

**Files:**
- Modify: `src/lib/store.ts:1457-1535`
- Test: `tests/demand/archiveSavesSurviveConcurrentCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("archiveTask — survives a sibling facility completed by someone else in the meantime", () => {
  afterEach(() => vi.resetModules());

  it("archives the task without clobbering a facility completion that landed after this device's last read", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const local: PickingTask = {
      no: "TASK-ARCHIVE",
      channel: CHANNEL,
      demand: [],
      facilities: [{ no: "TASK-ARCHIVE-MH", taskNo: "TASK-ARCHIVE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] }],
      shortfall: [],
      createdAt: new Date().toISOString(),
      archived: false,
    };
    const freshFromServer: PickingTask = { ...local, facilities: [{ ...local.facilities[0], status: "completed", pickedTotal: 9, bad: 0 }] };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [local] });

    await useStore.getState().archiveTask("TASK-ARCHIVE");

    const saved = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    expect(saved.archived).toBe(true);
    expect(saved.facilities[0].status).toBe("completed");
    expect(saved.facilities[0].pickedTotal).toBe(9);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/archiveSavesSurviveConcurrentCompletion.test.ts`
Expected: FAIL — `saved.facilities[0].status` comes back `"open"` (old code pushes the stale local `archived` object whole).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.ts`, replace each of the five raw `updateTaskData` calls:

Line 1462 (`archiveTask`): `if (isSupabaseConfigured) await saveTaskFlag(archived, { archived: true });`

Line 1471 (`unarchiveTask`): `if (isSupabaseConfigured) await saveTaskFlag(restored, { archived: false });`

Lines 1485-1493 (`archiveAllActiveTasks`), replace the loop body:
```ts
        if (isSupabaseConfigured) {
          for (const t of archivedTasks) {
            try {
              await saveTaskFlag(t, { archived: true });
            } catch (e) {
              set({ notice: "Could not archive " + t.no + ": " + (e as Error).message });
            }
          }
        }
```

Lines 1504-1512 (`unarchiveAllTasks`), same shape with `{ archived: false }`.

Lines 1524-1532 (`archiveByCutoff`), same shape with `{ archived: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand/archiveSavesSurviveConcurrentCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/archiveSavesSurviveConcurrentCompletion.test.ts
git commit -m "fix: save archive/unarchive actions through saveTaskFlag"
```

---

## High

### Task 9: Paginated `fetchAllTasks`

**Files:**
- Modify: `src/lib/tasksSupabase.ts:13-18`
- Test: `tests/app/tasksPagination.test.ts`

`fetchAllTasks` orders `created_at` ascending with no `.range()` loop, so once the `tasks` table exceeds PostgREST's silent 1000-row default, the rows dropped are the NEWEST tasks — today's picklists vanish from the Supervisor queue, the Repository and every report at once, with no error anywhere. `fetchStock` (`src/lib/supabaseStock.ts:24-38`) already handles this correctly via a paging loop; this replicates that pattern.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// PostgREST silently caps an un-ranged select at 1000 rows. `fetchStock` in
// supabaseStock.ts already pages past it; `fetchAllTasks` does not — and
// because it orders created_at ASCENDING, the rows it silently drops are the
// NEWEST tasks: once the tasks table passes 1000 rows, today's picklists stop
// appearing in the Supervisor queue, the Repository and every report at once.
//
// Supabase's query builder is both chainable and thenable: each filter/sort
// method returns the builder, and awaiting the builder OR awaiting .range()
// runs the query. This stub mimics both, so the same test drives the current
// un-paged code (which awaits the builder and therefore only ever sees page
// one) and the fixed paging code.
let pages: { data: unknown[] }[] = [];
const rangeCalls: [number, number][] = [];

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = vi.fn(self);
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    return Promise.resolve({ data: pages[rangeCalls.length - 1]?.data ?? [], error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: pages[0]?.data ?? [], error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn(() => queryBuilder()) },
}));

describe("fetchAllTasks — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
  });

  it("returns every task, including the newest ones past row 1000", async () => {
    const { fetchAllTasks } = await import("../../src/lib/tasksSupabase");

    // 1000 older tasks, then the 1001st — the most recently created one,
    // because the query orders created_at ascending.
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      data: { no: `B2BE-BLINKIT-260101-${String(i).padStart(3, "0")}`, channel: "Blinkit", facilities: [] },
    }));
    const secondPage = [
      {
        created_at: "2026-09-17T09:00:00.000Z",
        data: { no: "B2BE-BLINKIT-260917-001", channel: "Blinkit", facilities: [] },
      },
    ];
    pages = [{ data: firstPage }, { data: secondPage }];

    const tasks = await fetchAllTasks();

    expect(tasks).toHaveLength(1001);
    expect(tasks.map((t) => t.no)).toContain("B2BE-BLINKIT-260917-001");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("stops after a short page instead of looping forever", async () => {
    const { fetchAllTasks } = await import("../../src/lib/tasksSupabase");
    pages = [{ data: [{ created_at: "2026-09-17T09:00:00.000Z", data: { no: "ONLY-ONE", channel: "Blinkit", facilities: [] } }] }];

    const tasks = await fetchAllTasks();

    expect(tasks.map((t) => t.no)).toEqual(["ONLY-ONE"]);
    expect(rangeCalls).toEqual([[0, 999]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/tasksPagination.test.ts`
Expected: FAIL — the first test gets 1000 tasks instead of 1001, `B2BE-BLINKIT-260917-001` is missing, and `rangeCalls` is `[]` because the current code never calls `.range()`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tasksSupabase.ts — replace lines 13-18

/**
 * Every task. Paged past PostgREST's silent 1000-row default the same way
 * fetchStock() in supabaseStock.ts is — without this, once the tasks table
 * passes 1000 rows the rows quietly dropped are the NEWEST ones (this orders
 * created_at ascending), so today's picklists vanish from every screen at
 * once with no error anywhere.
 */
export async function fetchAllTasks(): Promise<PickingTask[]> {
  if (!supabase) return [];
  const page = 1000;
  const all: TaskRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("tasks")
      .select("data,created_at")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as TaskRow[]));
    if (data.length < page) break;
  }
  return all.map((r) => r.data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/tasksPagination.test.ts tests/demand tests/repository`
Expected: PASS — the new file passes and no existing demand/repository test regresses (they mock `fetchAllTasks` wholesale, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add tests/app/tasksPagination.test.ts src/lib/tasksSupabase.ts
git commit -m "fix: page fetchAllTasks past PostgREST's 1000-row cap so the newest picklists stop disappearing"
```

---

### Task 10: Paginated `fetchHolds`

**Files:**
- Modify: `src/lib/holdsSupabase.ts:36-42`
- Test: `tests/holds/holdsPagination.test.ts`

Same PostgREST 1000-row cap as Task 9. `fetchHolds` orders `held_at` descending and returns both active and released holds in one list, so the rows silently dropped are the OLDEST holds — exactly what the aging pivot's "&gt; 10 days"/"SLA breached" buckets exist to surface. Worse, `activeHoldKeys()` is built from this list and feeds `allocate()`: a hold that falls off the end stops blocking its lot, so the engine can re-offer stock someone explicitly held.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

let pages: { data: unknown[] }[] = [];
const rangeCalls: [number, number][] = [];

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = vi.fn(self);
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    return Promise.resolve({ data: pages[rangeCalls.length - 1]?.data ?? [], error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: pages[0]?.data ?? [], error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn(() => queryBuilder()) },
}));

function holdRow(id: number, heldAt: string) {
  return {
    id,
    sku: `SKU-${id}`,
    facility: "SL Mother Hub",
    bin: "R7-C19-002",
    batch: `BA${String(36161 + id)}`,
    qty: 12,
    held_at: heldAt,
    held_by: "Supervisor",
    reason: "Batch mismatch",
    source_task_no: "B2BE-BLINKIT-260101-001",
    released_at: null,
    released_by: null,
  };
}

describe("fetchHolds — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
  });

  it("returns every hold, including the oldest ones past row 1000", async () => {
    const { fetchHolds } = await import("../../src/lib/holdsSupabase");

    const firstPage = Array.from({ length: 1000 }, (_, i) => holdRow(i + 1, `2026-09-0${(i % 9) + 1}T10:00:00.000Z`));
    const secondPage = [holdRow(9999, "2025-11-04T10:00:00.000Z")]; // the genuinely oldest, still-active hold
    pages = [{ data: firstPage }, { data: secondPage }];

    const holds = await fetchHolds();

    expect(holds).toHaveLength(1001);
    expect(holds.map((h) => h.id)).toContain(9999);
    expect(holds.find((h) => h.id === 9999)!.heldAt).toBe("2025-11-04T10:00:00.000Z");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("still maps a single short page into Hold objects with camelCase fields", async () => {
    const { fetchHolds } = await import("../../src/lib/holdsSupabase");
    pages = [{ data: [holdRow(1, "2026-09-06T20:30:00.000Z")] }];

    const holds = await fetchHolds();

    expect(holds).toEqual([
      {
        id: 1,
        sku: "SKU-1",
        facility: "SL Mother Hub",
        bin: "R7-C19-002",
        batch: "BA36162",
        qty: 12,
        heldAt: "2026-09-06T20:30:00.000Z",
        heldBy: "Supervisor",
        reason: "Batch mismatch",
        sourceTaskNo: "B2BE-BLINKIT-260101-001",
        releasedAt: undefined,
        releasedBy: undefined,
      },
    ]);
    expect(rangeCalls).toEqual([[0, 999]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/holds/holdsPagination.test.ts`
Expected: FAIL — first test gets 1000 holds, id 9999 missing, `rangeCalls` empty because the current code never calls `.range()`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holdsSupabase.ts — replace lines 36-42

/**
 * Every hold, active and released — callers filter for active client-side.
 * Paged past PostgREST's silent 1000-row default (same loop as fetchStock in
 * supabaseStock.ts): this is ordered held_at DESCENDING, so an un-paged fetch
 * drops the OLDEST holds — the ones the aging pivot's "&gt; 10 days" bucket
 * exists to surface, and whose keys activeHoldKeys() feeds into allocate().
 * A hold that falls off the end silently stops blocking its lot.
 */
export async function fetchHolds(): Promise<Hold[]> {
  if (!supabase) return [];
  const page = 1000;
  const all: HoldRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("stock_holds")
      .select("*")
      .order("held_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as HoldRow[]));
    if (data.length < page) break;
  }
  return all.map(fromRow);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/holds`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/holds/holdsPagination.test.ts src/lib/holdsSupabase.ts
git commit -m "fix: page fetchHolds past PostgREST's 1000-row cap so old holds keep blocking their lots"
```

---

### Task 11: Paginated `fetchGatepassAdherence`

**Files:**
- Modify: `src/lib/gatepassAdherenceSupabase.ts:101-116`
- Test: `tests/app/gatepassAdherencePagination.test.ts`

Same PostgREST cap. This query filters (`.eq used_for_performance` / `.gte report_date`) then sorts `report_date` desc, `adherence_pct` asc — so the rows trimmed at the boundary are the HIGHEST-adherence gate passes of the oldest day still in range. Every aggregate built on top is then computed from a biased, worst-performers-only slice, reading as a lower adherence % than reality.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

let pages: { data: unknown[] }[] = [];
const rangeCalls: [number, number][] = [];
const filters: { method: string; args: unknown[] }[] = [];

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const record = (method: string) => vi.fn((...args: unknown[]) => {
    filters.push({ method, args });
    return chain;
  });
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = record(m);
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    return Promise.resolve({ data: pages[rangeCalls.length - 1]?.data ?? [], error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: pages[0]?.data ?? [], error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn(() => queryBuilder()) },
}));

function adherenceRow(code: string, pct: number) {
  return {
    gatepass_code: code,
    facility: "SL Mother Hub",
    report_date: "2026-09-16",
    instructed_qty: 100,
    compliant_qty: Math.round(pct),
    adherence_pct: pct,
    lines: [],
  };
}

describe("fetchGatepassAdherence — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
    filters.length = 0;
  });

  it("returns every scored gate pass, including the high-adherence tail past row 1000", async () => {
    const { fetchGatepassAdherence } = await import("../../src/lib/gatepassAdherenceSupabase");

    const firstPage = Array.from({ length: 1000 }, (_, i) => adherenceRow(`GPSLMH${10000 + i}`, 40 + i / 100));
    const secondPage = [adherenceRow("GPSLMH99999", 100)]; // a perfect-score gate pass, trimmed today
    pages = [{ data: firstPage }, { data: secondPage }];

    const rows = await fetchGatepassAdherence(30);

    expect(rows).toHaveLength(1001);
    expect(rows.map((r) => r.gatepass_code)).toContain("GPSLMH99999");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("keeps the used_for_performance and report_date filters and both sorts", async () => {
    const { fetchGatepassAdherence } = await import("../../src/lib/gatepassAdherenceSupabase");
    pages = [{ data: [adherenceRow("GPSLMH10000", 88)] }];

    await fetchGatepassAdherence(7);

    expect(filters.some((f) => f.method === "eq" && f.args[0] === "used_for_performance" && f.args[1] === true)).toBe(true);
    expect(filters.some((f) => f.method === "gte" && f.args[0] === "report_date")).toBe(true);
    expect(filters.filter((f) => f.method === "order").map((f) => f.args[0])).toEqual(["report_date", "adherence_pct"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/gatepassAdherencePagination.test.ts`
Expected: FAIL — first test gets 1000 rows, `GPSLMH99999` missing, `rangeCalls` empty. (The second test passes already; it is a guard so the paging rewrite cannot quietly drop a filter.)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/gatepassAdherenceSupabase.ts — replace lines 101-116

/**
 * Rows for the last `days` report dates — populated daily by
 * GatepassAdherenceCheck.gs. Paged past PostgREST's silent 1000-row default
 * (same loop as fetchStock in supabaseStock.ts): the sort is report_date
 * DESC then adherence_pct ASC, so an un-paged fetch trims the
 * HIGHEST-adherence gate passes of the boundary day — and every aggregate
 * built on this (fetchLatestDayAdherence) then reports a worse adherence %
 * than actually happened.
 */
export async function fetchGatepassAdherence(days = 30): Promise<GatepassAdherence[]> {
  if (!supabase) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString().slice(0, 10);
  const page = 1000;
  const all: GatepassAdherence[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("gatepass_adherence")
      .select("gatepass_code,facility,report_date,instructed_qty,compliant_qty,adherence_pct,lines")
      .eq("used_for_performance", true)
      .gte("report_date", sinceIso)
      .order("report_date", { ascending: false })
      .order("adherence_pct", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as GatepassAdherence[]));
    if (data.length < page) break;
  }
  return all;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/app/gatepassAdherencePagination.test.ts src/lib/gatepassAdherenceSupabase.ts
git commit -m "fix: page fetchGatepassAdherence so the highest-adherence gate passes stop being trimmed"
```

---

### Task 12: Realtime subscription for stock holds

**Files:**
- Create: `supabase/add_stock_holds_realtime.sql`
- Modify: `src/lib/holdsSupabase.ts` (append `subscribeHolds`)
- Modify: `src/lib/store.ts:620` (AppState), `src/lib/store.ts:832-840` (add `startHoldsRealtime`), `src/lib/store.ts:25` (import)
- Modify: `src/App.tsx:172-184`, `src/App.tsx:202-238`
- Test: `tests/holds/holdsRealtime.test.ts`

`stock_holds` is the only shared entity with no `subscribeX`. `checkHoldAutoRelease` (`store.ts:1663-1665`) returns at `due.length === 0` **before** reaching `await get().loadHolds()`, so the 60-second timer refreshes holds only on the rare tick where a lot has actually emptied. Otherwise `holds` is loaded once at mount (`App.tsx:205`) and thereafter only by this device's own `placeHold`/`releaseHold`. A hold placed or released on another device never arrives — and `activeHoldKeys(holds)` feeds `allocate()`, so this device keeps offering stock another supervisor has held.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Handler {
  event: string;
  config: { event: string; schema: string; table: string };
  cb: () => void;
}
const channelNames: string[] = [];
const handlers: Handler[] = [];
const removed: unknown[] = [];
let holdRows: unknown[] = [];

function fakeChannel(name: string) {
  channelNames.push(name);
  const ch: Record<string, unknown> = { name };
  ch.on = vi.fn((event: string, config: Handler["config"], cb: () => void) => {
    handlers.push({ event, config, cb });
    return ch;
  });
  ch.subscribe = vi.fn(() => ch);
  return ch;
}

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = vi.fn(self);
  let served = false;
  chain.range = vi.fn(() => {
    const data = served ? [] : holdRows;
    served = true;
    return Promise.resolve({ data, error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: holdRows, error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => queryBuilder()),
    channel: vi.fn((name: string) => fakeChannel(name)),
    removeChannel: vi.fn((ch: unknown) => removed.push(ch)),
  },
}));

function holdRow(id: number, releasedAt: string | null = null) {
  return {
    id,
    sku: "SKU-HELD",
    facility: "SL Mother Hub",
    bin: "R7-C19-002",
    batch: "BA036161",
    qty: 40,
    held_at: "2026-09-16T10:00:00.000Z",
    held_by: "Supervisor A",
    reason: "Batch mismatch",
    source_task_no: "B2BE-BLINKIT-260916-001",
    released_at: releasedAt,
    released_by: releasedAt ? "Supervisor A" : null,
  };
}

beforeEach(() => {
  channelNames.length = 0;
  handlers.length = 0;
  removed.length = 0;
  holdRows = [];
});
afterEach(() => vi.resetModules());

describe("subscribeHolds", () => {
  it("listens for every change on the stock_holds table", async () => {
    const { subscribeHolds } = await import("../../src/lib/holdsSupabase");
    const onChange = vi.fn();

    subscribeHolds(onChange);

    expect(channelNames).toEqual(["stock-holds-realtime"]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].event).toBe("postgres_changes");
    expect(handlers[0].config).toEqual({ event: "*", schema: "public", table: "stock_holds" });

    handlers[0].cb();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("removes the channel when unsubscribed", async () => {
    const { subscribeHolds } = await import("../../src/lib/holdsSupabase");
    const stop = subscribeHolds(vi.fn());
    stop();
    expect(removed).toHaveLength(1);
  });
});

describe("startHoldsRealtime", () => {
  it("pulls another device's hold into this device's state without a reload", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    // This device starts with no holds at all.
    useStore.setState({ holds: [] });
    const stop = useStore.getState().startHoldsRealtime();

    // Another supervisor places a hold on R7-C19-002 / BA036161.
    holdRows = [holdRow(501)];
    handlers[0].cb();
    await vi.waitFor(() => expect(useStore.getState().holds).toHaveLength(1));

    expect(useStore.getState().holds[0].id).toBe(501);
    expect(useStore.getState().holds[0].bin).toBe("R7-C19-002");

    stop();
    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/holds/holdsRealtime.test.ts`
Expected: FAIL — `subscribeHolds` is not exported from `holdsSupabase.ts` (import is `undefined`), and `useStore.getState().startHoldsRealtime` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holdsSupabase.ts — append at the end of the file

/**
 * Live updates: fires whenever ANY user places or releases a hold.
 * Refetch-on-any-change, the same pattern as subscribePickers /
 * subscribeChannelOverrides — the hold list is small enough that a full
 * reload beats diffing rows.
 *
 * Without this, holds were the one shared entity with no realtime feed:
 * loaded once at mount, then only after this device's own placeHold /
 * releaseHold (checkHoldAutoRelease returns before loadHolds() whenever
 * nothing is due, so the 60s timer is not a refresh path). A hold placed
 * elsewhere stayed invisible here indefinitely — and activeHoldKeys() feeds
 * allocate(), so this device kept offering held stock.
 *
 * Requires stock_holds to be in the supabase_realtime publication — see
 * supabase/add_stock_holds_realtime.sql.
 */
export function subscribeHolds(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("stock-holds-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "stock_holds" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
```

```ts
// src/lib/store.ts:25 — extend the existing holdsSupabase import
import { fetchHolds, insertHold, releaseHoldRow, subscribeHolds } from "./holdsSupabase";
```

```ts
// src/lib/store.ts — in AppState, directly after `loadHolds: () => Promise<void>;` (line 620)
  startHoldsRealtime: () => () => void;
```

```ts
// src/lib/store.ts — insert directly after the loadHolds action (after line 840)

      startHoldsRealtime: () => {
        if (!isSupabaseConfigured) return () => {};
        return subscribeHolds(() => void get().loadHolds());
      },
```

```tsx
// src/App.tsx — add to the Workspace() destructure (after `loadHolds,` on line 172)
    startHoldsRealtime,
```

```tsx
// src/App.tsx — in the mount effect, after `const stopPickers = startPickersRealtime();` (line 211)
    const stopHolds = startHoldsRealtime();
```

```tsx
// src/App.tsx — in the same effect's cleanup, after `stopPickers();` (line 231)
      stopHolds();
```

```sql
-- supabase/add_stock_holds_realtime.sql
--
-- stock_holds has no tracked migration at all (see Task 17, the RLS decision
-- task) — the table was created by hand in the dashboard. Realtime delivery
-- is opt-in per table in Supabase, so subscribeHolds() in
-- src/lib/holdsSupabase.ts silently receives nothing until stock_holds is
-- added to the publication, exactly like pickers / channel_overrides /
-- app_settings / tasks already are.
--
-- Run this in Supabase -> SQL Editor. Safe to re-run: the DO block skips the
-- table if it is already published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_holds'
  ) then
    alter publication supabase_realtime add table stock_holds;
  end if;
end $$;

-- Realtime needs the full old row on UPDATE/DELETE to build its payload;
-- without this a release (an UPDATE setting released_at) delivers only the
-- primary key.
alter table stock_holds replica identity full;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/holds`
Expected: PASS

- [ ] **Step 5: Run the migration against Supabase**

Run `supabase/add_stock_holds_realtime.sql` in Supabase → SQL Editor, then confirm:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```
Expected: the list includes `stock_holds` alongside `app_settings`, `channel_overrides`, `pickers`, `tasks`.

- [ ] **Step 6: Commit**

```bash
git add tests/holds/holdsRealtime.test.ts src/lib/holdsSupabase.ts src/lib/store.ts src/App.tsx supabase/add_stock_holds_realtime.sql
git commit -m "feat: subscribe to stock_holds realtime so holds placed on another device reach every browser"
```

---

### Task 13: SupervisorQueue must not offer discarded or gate-pass-pending rounds as interactive tabs

**Files:**
- Modify: `src/components/SupervisorQueue.tsx:384`
- Test: `tests/supervisor/discardedRoundNotInteractive.test.tsx`

`all` is `supervisorVisibleFacilityLists(tasks)` (line 331), which drops archived, discarded, and gate-pass-pending picklists. But `families` is built from the raw `tasks` (line 384), so `familyFor(f, families)` hands `PicklistItem` a family containing those excluded rounds. `RoundTabs` renders one button per round; selecting one hands it straight to `<FacilityBlock f={active} …/>`, which for an open picklist renders "Assign all to", per-line picker selects, not-found inputs, "Mark completed" and Discard. A discarded picklist can therefore be re-assigned and completed from the queue, and a gate-pass-pending one can be picked before its gate pass exists.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
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

// The queue's own item list (supervisorVisibleFacilityLists) drops discarded
// picklists AND anything still in Gate Pass Allocation Pending. The round
// tabs were built from the raw `tasks` instead, so those same excluded rounds
// came back as clickable tabs on a sibling round's card — and selecting one
// rendered it through FacilityBlock with the full open-picklist control set:
// "Assign all to", per-line picker selects, not-found inputs, "Mark
// completed", and Discard. A picklist a supervisor had explicitly cancelled
// could be re-assigned and completed from the queue; a picklist deliberately
// held back until its gate pass exists could be picked without one.
function taskWithDiscardedRoundTwo(): PickingTask {
  return {
    no: "TASK-DISC",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-10T00:00:00Z",
    facilities: [
      {
        no: "TASK-DISC-MH",
        taskNo: "TASK-DISC",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH10501",
        createdAt: "2026-09-10T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 5 }],
      },
      {
        no: "TASK-DISC-AMB-R2",
        taskNo: "TASK-DISC",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        discarded: true,
        gatePassNo: "GPSLAMB27801",
        createdAt: "2026-09-11T00:00:00Z",
        reofferedFrom: "TASK-DISC-MH",
        lines: [{ rid: 2, sku: "SKU-1", name: "Product 1", facility: "SL Ambient", bin: "C1", batch: "BA000111", exp: [2099, 2], rem: 12, qty: 3 }],
      },
    ],
  };
}

function taskWithPendingRoundTwo(): PickingTask {
  return {
    no: "TASK-PEND",
    channel: "Flipkart",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-12T00:00:00Z",
    facilities: [
      {
        no: "TASK-PEND-MH",
        taskNo: "TASK-PEND",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH10777",
        createdAt: "2026-09-12T00:00:00Z",
        lines: [{ rid: 10, sku: "SKU-2", name: "Product 2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 9 }],
      },
      {
        // No gatePassNo and the parent task has none either -> still in
        // "Gate Pass Allocation Pending", deliberately invisible to the queue.
        no: "TASK-PEND-AMB-R2",
        taskNo: "TASK-PEND",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        createdAt: "2026-09-13T00:00:00Z",
        reofferedFrom: "TASK-PEND-MH",
        lines: [{ rid: 11, sku: "SKU-2", name: "Product 2", facility: "SL Ambient", bin: "C1", batch: "B2", exp: [2099, 2], rem: 12, qty: 2 }],
      },
    ],
  };
}

function asSupervisor() {
  useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "admin" } });
}

describe("SupervisorQueue — rounds the queue excludes are not offered as tabs", () => {
  it("does not render a tab for a discarded round", () => {
    asSupervisor();
    useStore.setState({ tasks: [taskWithDiscardedRoundTwo()] });
    render(<SupervisorQueue />);

    expect(screen.queryAllByRole("button", { name: /Round 2 · SL Ambient/ })).toHaveLength(0);
    expect(screen.queryByText(/TASK-DISC-AMB-R2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GPSLAMB27801/)).not.toBeInTheDocument();
    // The visible round-1 card is untouched.
    expect(screen.getByText(/GPSLMH10501/)).toBeInTheDocument();
  });

  it("does not render a tab for a round still in Gate Pass Allocation Pending", () => {
    asSupervisor();
    useStore.setState({ tasks: [taskWithPendingRoundTwo()] });
    render(<SupervisorQueue />);

    expect(screen.queryAllByRole("button", { name: /Round 2 · SL Ambient/ })).toHaveLength(0);
    expect(screen.queryByText(/TASK-PEND-AMB-R2/)).not.toBeInTheDocument();
    expect(screen.getByText(/GPSLMH10777/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/discardedRoundNotInteractive.test.tsx`
Expected: FAIL — both tests find one `Round 2 · SL Ambient` tab (`expected [ <button/> ] to have a length of +0 but got 1`), because `groupPicklistFamilies(tasks)` includes the excluded rounds.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/SupervisorQueue.tsx — replace line 384

  // Round tabs are built from exactly the set of facility picklists this
  // queue itself shows. Grouping the raw `tasks` (as this used to) pulled in
  // rounds the queue deliberately excludes — a discarded one, or one still in
  // Gate Pass Allocation Pending — and rendered them as fully interactive tabs
  // on a sibling round's card: selecting one hands it straight to
  // <FacilityBlock f={active} …/>, which for an open picklist renders "Assign
  // all to", per-line picker selects, not-found inputs, "Mark completed" and
  // Discard. Same shape as the filter PicklistRepository.tsx already applies
  // before grouping (see its tasksWithoutDiscarded), just driven off `all`,
  // which already accounts for archived + discarded + gate-pass-pending in
  // one place (supervisorVisibleFacilityLists).
  const visibleNos = useMemo(() => new Set(all.map((f) => f.no)), [all]);
  const families = useMemo(
    () =>
      groupPicklistFamilies(
        tasks
          .map((t) => ({ ...t, facilities: t.facilities.filter((f) => visibleNos.has(f.no)) }))
          .filter((t) => t.facilities.length > 0),
      ),
    [tasks, visibleNos],
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisor tests/repository`
Expected: PASS — including the existing `roundHistoryInSupervisor.test.tsx`, whose rounds all carry gate passes and are not discarded, so they stay in `visibleNos` and their tabs still render.

- [ ] **Step 5: Commit**

```bash
git add tests/supervisor/discardedRoundNotInteractive.test.tsx src/components/SupervisorQueue.tsx
git commit -m "fix: build supervisor round tabs from visible picklists only, so discarded and gate-pass-pending rounds stop rendering as interactive"
```

---

### Task 14: Reject a gate pass reused twice within one `generate()` batch

**Files:**
- Modify: `src/lib/store.ts:1031` (add the batch map), `src/lib/store.ts:1065-1073` (check it)
- Test: `tests/demand/generateGatePassCollisionWithinBatch.test.ts`

`findGatePassConflict(tasks, gp, no)` only inspects the freshly-refetched `tasks`; nothing is inserted until after the whole loop. Two demand rows carrying the same gate pass under **different channels** are separate `gatePassGroupKey` groups and therefore separate tasks — and both are accepted. This is precisely the gap `seqUsedThisBatch` already closed for task *numbers*; this task applies the same batch-scoped accumulation to gate passes.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return {
    ...actual,
    // generate() refetches tasks before allocating — empty, so nothing that
    // really exists in Supabase interferes with this fixture.
    fetchAllTasks: vi.fn(async () => []),
    nextSequence: vi.fn(async () => 1),
    insertTask: vi.fn(async () => undefined),
  };
});

// Sibling of the already-fixed task-number collision (see
// generateTaskNumberCollision.test.ts and seqUsedThisBatch in store.ts).
// findGatePassConflict only looks at the freshly-refetched `tasks`, and
// nothing is inserted until AFTER the whole allocation loop — so a gate pass
// number typed onto two rows of one demand CSV under two DIFFERENT channels
// (separate gatePassGroupKey groups, therefore separate tasks) passed the
// duplicate check twice and got applied to both. The same real failure mode as
// GPSLAMB27789 / GPSLMH9820, just inside a single upload instead of across two:
// whoever searches that gate pass finds two unrelated orders claiming it.
const GATE_PASS = "GPSLMH9820"; // GPSLMH prefix -> reconciles to SL Mother Hub

describe("generate() — one gate pass number cannot be claimed twice in the same batch", () => {
  afterEach(() => vi.resetModules());

  it("applies it to the first channel and rejects it for the second", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-DUP-GP", name: "Product", batch: "BA019232", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-DUP-GP": { name: "Product", shelf: 24 } }, tasks: [] });
    useStore.getState().setDemand([
      { channel: "Blinkit", sku: "SKU-DUP-GP", qty: 10, gatePassNo: GATE_PASS },
      { channel: "Zepto", sku: "SKU-DUP-GP", qty: 10, gatePassNo: GATE_PASS },
    ]);

    await useStore.getState().generate(null, "Tester");

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2);

    const blinkit = tasks.find((t) => t.channel === "Blinkit")!;
    const zepto = tasks.find((t) => t.channel === "Zepto")!;

    // Exactly one of the two ends up holding the number — never both.
    const holders = tasks.flatMap((t) => t.facilities).filter((f) => f.gatePassNo === GATE_PASS);
    expect(holders).toHaveLength(1);

    // First group in demand order keeps it; the second falls through to
    // pending, exactly as if no gate pass had been supplied for it.
    expect(blinkit.facilities[0].gatePassNo).toBe(GATE_PASS);
    expect(zepto.facilities[0].gatePassNo).toBeUndefined();

    // And the planner is told, naming the order that already claimed it.
    expect(useStore.getState().notice).toMatch(/already in use elsewhere/);
    expect(useStore.getState().notice).toContain(GATE_PASS);
    expect(useStore.getState().notice).toContain(blinkit.no);
    expect(useStore.getState().notice).toMatch(/awaiting gate pass allocation/);

    useStore.setState(initialState, true);
  });

  it("still lets two channels each keep their own distinct gate pass", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-OK-GP", name: "Product", batch: "BA019232", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-OK-GP": { name: "Product", shelf: 24 } }, tasks: [] });
    useStore.getState().setDemand([
      { channel: "Blinkit", sku: "SKU-OK-GP", qty: 10, gatePassNo: "GPSLMH10001" },
      { channel: "Zepto", sku: "SKU-OK-GP", qty: 10, gatePassNo: "GPSLMH10002" },
    ]);

    await useStore.getState().generate(null, "Tester");

    const tasks = useStore.getState().tasks;
    expect(tasks.find((t) => t.channel === "Blinkit")!.facilities[0].gatePassNo).toBe("GPSLMH10001");
    expect(tasks.find((t) => t.channel === "Zepto")!.facilities[0].gatePassNo).toBe("GPSLMH10002");
    expect(useStore.getState().notice).not.toMatch(/already in use elsewhere/);

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/generateGatePassCollisionWithinBatch.test.ts`
Expected: FAIL on the first test — `holders` has length 2 (both Blinkit and Zepto carry `GPSLMH9820`), `zepto.facilities[0].gatePassNo` is `"GPSLMH9820"` instead of `undefined`, and the notice contains no "already in use elsewhere" warning. The second test passes already and guards against over-rejecting.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/store.ts — add directly after the `rejectedGatePasses` declaration (line 1031)

        // Gate pass numbers THIS batch has already handed out, and to which
        // task. findGatePassConflict below only sees `tasks` (the fresh
        // refetch), and nothing is inserted until after this whole loop — so
        // one number typed onto two rows of a single CSV under two different
        // channels (separate gatePassGroupKey groups, therefore separate
        // tasks) passed the check twice and got applied to both. Exactly the
        // gap seqUsedThisBatch above already closes for task NUMBERS, applied
        // to gate passes.
        const gatePassUsedThisBatch = new Map<string, { taskNo: string; facility: string }>();
```

```ts
// src/lib/store.ts — replace the gate pass loop body (lines 1065-1073)

          for (const facility of Object.keys(gatePassByFacility)) {
            const gp = gatePassByFacility[facility];
            if (!gp) continue;
            const claimedThisBatch = gatePassUsedThisBatch.get(gp);
            const conflict =
              findGatePassConflict(tasks, gp, no) ??
              (claimedThisBatch && claimedThisBatch.taskNo !== no ? claimedThisBatch : undefined);
            if (conflict) {
              rejectedGatePasses.push({ gatePassNo: gp, conflict });
              gatePassByFacility[facility] = undefined;
            } else {
              gatePassUsedThisBatch.set(gp, { taskNo: no, facility });
            }
          }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand`
Expected: PASS — including `generateRejectsUsedGatePass.test.ts` (cross-batch conflicts), `setFacilityGatePass.test.ts` and `crossFacilityReofferGatePass.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/demand/generateGatePassCollisionWithinBatch.test.ts src/lib/store.ts
git commit -m "fix: reject a gate pass number reused across channels within one generate() batch"
```

---

### Task 15: Replace the rid-based round-2+ exclusion with lot-identity exclusion

**Files:**
- Modify: `src/lib/store.ts` (`applyPicks`'s not-found re-offer block, `allocateAcrossFacilities`, `computeChannelAllocations`)
- Modify: `src/lib/engine.ts` (`AllocateArgs`/`allocate()` — drop the now-dead `exclude: number[]` param)
- Test: `tests/demand/staleRidExclusionAcrossRounds.test.ts`

The already-shipped fix (PR #12) folds the completing facility's own just-failed lines into `heldKeysForRound2` (identity-keyed, stable). What's left unfixed is `usedRids` (`store.ts:1234`) — still built from every line's remembered `.rid` across the whole task, and still passed as the `exclude` array to `allocateAcrossFacilities`/`allocate()` (`engine.ts:89`, `!exclude.includes(b.rid)`). `rid` is reassigned on every stock resync (`rowsFromTuples`), so a line created before a resync holds a `rid` that may no longer match its own lot in the current `stock` snapshot — and can instead coincidentally match a totally different, currently-valid lot's rid, which then gets wrongly excluded. Worse: for rounds *before* the one that just completed, no persisted Hold record backstops them either whenever `placeHold()` no-ops (e.g. no Supabase configured — this repo's test environment). `usedRids` was the *only* defense against round 3 landing back on round 1's already-failed bin, and it's broken.

This fix was implemented and independently verified against the real codebase before being written into this plan: **353/353 tests pass** (`npx vitest run`) and `npx tsc -b` is clean with this exact diff applied.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// Three lots of the same SKU at the same facility, all eligible, sorted FEFO
// BIN-A < BIN-B < BIN-C. rids below are whatever the CURRENT stock resync
// happens to have assigned them "right now" — deliberately disjoint from any
// rid a still-open or already-completed picklist line remembers, standing in
// for "stock has been resynced (rids reassigned) since that line was made."
function stock(rids: [number, number, number]): StockRow[] {
  return [
    { rid: rids[0], location: "SL Mother Hub", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 1], qty: 81, shelf: 24, type: "Good", active: "Active" },
    { rid: rids[1], location: "SL Mother Hub", bin: "BIN-B", sku: "SKU-NF", name: "Product NF", batch: "BATCH-B", exp: [2099, 2], qty: 81, shelf: 24, type: "Good", active: "Active" },
    { rid: rids[2], location: "SL Mother Hub", bin: "BIN-C", sku: "SKU-NF", name: "Product NF", batch: "BATCH-C", exp: [2099, 3], qty: 81, shelf: 24, type: "Good", active: "Active" },
  ];
}

function taskWithRound1(rid: number): PickingTask {
  return {
    no: "TASK-NF",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-NF", qty: 81, gatePassNo: "GPSLMH-9101" }],
    facilities: [
      {
        no: "TASK-NF-MH",
        taskNo: "TASK-NF",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9101",
        lines: [{ rid, sku: "SKU-NF", name: "Product NF", facility: "SL Mother Hub", bin: "BIN-A", batch: "BATCH-A", exp: [2099, 1], rem: 900, qty: 81 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

// Mirrors a real production shape: round 1 fails on BIN-A, its auto re-offer
// (round 2) fails on BIN-B too, and — critically — stock gets resynced
// (rids reassigned) between each round. This repo has no Supabase configured
// in tests, so placeHold() never actually persists a Hold for round 1's
// failure — round 3's only remaining defense against landing back on round
// 1's bin is the in-task exclusion built from task.facilities' own
// remembered lines. That exclusion was keyed on `rid`, which is stale for
// both round 1's and round 2's lines by the time round 3 is computed, so it
// silently matched nothing and round 3 could land right back on BIN-A.
describe("not-found re-offer avoids EVERY prior round's bin, not just the one that just failed", () => {
  it("stale rid exclusion: round 3 skips round 1's AND round 2's failed bins even though both rounds' remembered rids are stale relative to the current stock snapshot", async () => {
    // Round 1 is created against an earlier stock snapshot; its line
    // remembers rid 901 for BIN-A/BATCH-A.
    useStore.setState({ stock: stock([901, 902, 903]), skus: { "SKU-NF": { name: "Product NF", shelf: 24 } }, tasks: [taskWithRound1(901)] });

    // Stock resyncs before round 1 is worked — BIN-A/BATCH-A is now rid 501.
    useStore.setState({ stock: stock([501, 502, 503]) });
    await useStore.getState().applyPicks("TASK-NF-MH", { 901: 81 }, { 901: "Batch mismatch" }, "Tester");

    let updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round2 = updated.facilities.find((f) => f.round === 2)!;
    expect(round2.lines[0].bin).toBe("BIN-B");
    const round2Rid = round2.lines[0].rid; // whatever rid BIN-B/BATCH-B had at round-2 creation time (502)

    // Stock resyncs again before round 2 is worked — every lot gets a fresh
    // rid again, so round 2's remembered rid is now stale too.
    useStore.setState({ stock: stock([601, 602, 603]) });
    await useStore.getState().applyPicks(round2.no, { [round2Rid]: 81 }, { [round2Rid]: "Batch mismatch" }, "Tester");

    updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round3 = updated.facilities.find((f) => f.round === 3);
    expect(round3).toBeDefined();
    expect(round3!.lines[0].qty).toBe(81);
    // Must be the one lot neither round 1 nor round 2 already tried.
    expect(round3!.lines[0].bin).toBe("BIN-C");
    expect(round3!.lines[0].batch).toBe("BATCH-C");
  });

  it("does not cross-exclude a different facility's bin that happens to share the same bin+batch code", async () => {
    // Two facilities each have their own "BIN-A"/"BATCH-A" for this SKU —
    // bin/batch codes are only unique within a facility. Round 1 fails at SL
    // Mother Hub's BIN-A; the fix must not also exclude SL Ambient's
    // identically named BIN-A/BATCH-A, a completely different physical lot.
    const twoFacilityStock: StockRow[] = [
      { rid: 701, location: "SL Mother Hub", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 1], qty: 81, shelf: 24, type: "Good", active: "Active" },
      { rid: 702, location: "SL Ambient", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 2], qty: 81, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock: twoFacilityStock, skus: { "SKU-NF": { name: "Product NF", shelf: 24 } }, tasks: [taskWithRound1(701)] });

    await useStore.getState().applyPicks("TASK-NF-MH", { 701: 81 }, { 701: "Batch mismatch" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round2 = updated.facilities.find((f) => f.round === 2);
    expect(round2).toBeDefined();
    expect(round2!.lines[0].facility).toBe("SL Ambient");
    expect(round2!.lines[0].bin).toBe("BIN-A");
    expect(round2!.lines[0].batch).toBe("BATCH-A");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/staleRidExclusionAcrossRounds.test.ts`
Expected: FAIL on the first test — `expected 'BIN-A' to be 'BIN-C'` — round 3 lands right back on round 1's already-failed bin, exactly the production bug. (The second test already passes on unmodified code — it's a regression guard, not a reproduction, confirming facility-scoping was already correct.)

- [ ] **Step 3: Write minimal implementation**

In `src/lib/engine.ts`, drop the `exclude` parameter entirely:

```ts
// AllocateArgs — replace the `exclude?: number[];` field
  // Same sku+facility+bin+batch identity as reservedFor's key — bins to
  // exclude outright (active holds, and any lot a caller wants hard-blocked
  // for this allocation) rather than merely reserved-against. Also how a
  // caller keeps a single allocation from double-offering the same bin+batch
  // to two different demand lines: fold each result's lots back in via
  // holdKey before the next call, same as an already-active hold.
  heldKeys?: Set<string>;
```

```ts
// allocate() — remove the `const exclude = args.exclude ?? [];` line and the
// `!exclude.includes(b.rid) &&` filter condition immediately above the
// `!(heldKeys?.has(...))` check.
```

In `src/lib/store.ts`:

```ts
// allocateAcrossFacilities — drop the `exclude: number[],` parameter and the
// `exclude` field passed into `allocate({...})`.
```

```ts
// computeChannelAllocations — drop the `[]` argument in its
// allocateAcrossFacilities(d.sku, d.qty, cutoff, stock, reserved, [], heldKeys, rule.minBinQty)
// call, becoming:
      const w = allocateAcrossFacilities(d.sku, d.qty, cutoff, stock, reserved, heldKeys, rule.minBinQty);
```

Inside `applyPicks`'s not-found re-offer block, remove the `usedRids` declaration entirely and replace the `heldKeysForRound2` setup with:

```ts
          const heldKeysForRound2 = activeHoldKeys(state.holds);
          // Every bin+batch this task has EVER offered a line for, any round,
          // whether that line is still open, was picked, or came back
          // not-found — the re-offer we're about to build must never send a
          // lot back out that this same task already has a line against.
          // Deliberately keyed on sku+facility+bin+batch (see holdKey), NOT
          // on the line's remembered `rid`: rid is reassigned on every stock
          // resync (rowsFromTuples), so a line created before a resync holds
          // onto a rid that may no longer match that same physical lot's rid
          // in the current `stock` snapshot — a plain `rid` Set silently
          // fails to recognize it's the same lot and lets round N+1 land
          // right back on a bin an earlier round already tried (and, for
          // rounds before the one that just completed, this task's own
          // not-found holds may not have made it into `state.holds` yet
          // either — e.g. no Supabase configured, so placeHold() no-ops —
          // making this the only remaining guard against re-offering them).
          //
          // `task` (== parentTask) already carries the just-completed
          // facility with its resolved lines, so this single loop also
          // covers what used to be a separate pass just for THIS completion's
          // own not-found lines — folding those in before the real Hold
          // records exist is still required (they're written by the
          // holdsToCreate/placeHold loop below, which necessarily runs after
          // set()) — so activeHoldKeys(state.holds) above can't see them yet.
          //
          // Real incident this guards against: GPSLMH10477's round 2 was
          // generated 10ms after round 1 completed and landed right back on
          // round 1's exact bin (R7-C19-002) and batch (BA036161).
          for (const f of task.facilities) {
            for (const l of f.lines) heldKeysForRound2.add(holdKey(l.sku, f.facility, l.bin, l.batch));
          }
```

And replace the per-SKU allocation call inside that same block:

```ts
            const cutoff = cutoffMonths(rule, skuInfo.shelf);
            const w = allocateAcrossFacilities(sku, nfBySku[sku], cutoff, stock, reserved, heldKeysForRound2, rule.minBinQty);
            for (const f of Object.keys(w.byFacility)) {
              (r2[f] ??= []).push(...w.byFacility[f]);
              // Fold this SKU's own freshly-allocated lots back in so a
              // later SKU in this same loop can't be offered the same
              // bin+batch (two different demand lines never legitimately
              // share one physical lot within a single re-offer pass).
              w.byFacility[f].forEach((l) => heldKeysForRound2.add(holdKey(l.sku, l.facility, l.bin, l.batch)));
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/demand tests/repository`
Expected: PASS — verified in advance: full project (`npx vitest run`), 353/353 tests green with this exact change applied, and `npx tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add tests/demand/staleRidExclusionAcrossRounds.test.ts src/lib/store.ts src/lib/engine.ts
git commit -m "fix: exclude round-2+ candidate lots by sku+facility+bin+batch identity instead of unstable rids"
```

---

### Task 16: PickerView — stable per-line progress and per-line persistence

**Files:**
- Modify: `src/components/PickerView.tsx:42-89`, `src/components/PickerView.tsx:135`, `src/components/PickerView.tsx:144-145`
- Test: `tests/picker/pickerLineReassignedMidPick.test.tsx`

`lines` is recomputed from live `tasks` on every render and `criticalPathSort` orders by bin, so an extra line assigned mid-pick re-sorts the array under the positional `idx`. Observed on the unfixed code: picker taps Found on A1 → header "Line 2 of 2", bin A3. Supervisor assigns a line at bin **A0**. Header becomes **"Line 2 of 3" showing bin A1 again** — a line the picker already completed; A0 is never presented; the run still ends on "Your picking is done" while A0 sits unpicked and the facility stays open. Separately, `advance` returns early whenever `idx + 1 < lines.length`, so nothing at all is persisted until the final line — a picker who loses the tab, the app, or their picklist mid-run loses every line they had already walked.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, render, screen } from "@testing-library/react";
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

function task(): PickingTask {
  return {
    no: "TASK-PV",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      {
        no: "TASK-PV-MH",
        taskNo: "TASK-PV",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH11200", // PickerView only shows facilities past Gate Pass Allocation Pending
        lines: [
          { rid: 1, sku: "SKU-A", name: "Product A", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 5, picker: "Ravi" },
          { rid: 3, sku: "SKU-C", name: "Product C", facility: "SL Mother Hub", bin: "A3", batch: "BA000111", exp: [2099, 3], rem: 12, qty: 7, picker: "Ravi" },
        ],
      },
    ],
  };
}

function assignExtraLineAtA0() {
  act(() => {
    const t = JSON.parse(JSON.stringify(useStore.getState().tasks[0])) as PickingTask;
    t.facilities[0].lines.push({
      rid: 9, sku: "SKU-Z", name: "Product Z", facility: "SL Mother Hub",
      bin: "A0", batch: "BA777000", exp: [2099, 9], rem: 12, qty: 4, picker: "Ravi",
    });
    useStore.setState({ tasks: [t] });
  });
}

function asRavi() {
  useAuth.setState({ profile: { id: "u1", email: "ravi@example.com", display_name: "Ravi", role: "picker" } });
  useStore.setState({ tasks: [task()] });
}

describe("PickerView — progress survives the picklist changing mid-pick", () => {
  it("keeps the picker on the line they were actually standing at when a new line is assigned", async () => {
    const user = userEvent.setup();
    asRavi();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    // Line 1 of the run: A1.
    expect(screen.getByText("A1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Found — Picked 5/ }));
    expect(await screen.findByText("A3")).toBeVisible();

    // Supervisor assigns a line at bin A0, which sorts before everything.
    assignExtraLineAtA0();

    // The picker must still be standing at A3 — not sent back to A1.
    expect(screen.getByText("A3")).toBeVisible();
    expect(screen.queryByText("A1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Found — Picked 7/ })).toBeVisible();
  });

  it("persists each line as it is confirmed, not only at the end of the run", async () => {
    const user = userEvent.setup();
    asRavi();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    await user.click(screen.getByRole("button", { name: /Found — Picked 5/ }));
    expect(await screen.findByText("A3")).toBeVisible();

    // A1's result is already recorded on the task, before the run has finished.
    const lineA1 = useStore.getState().tasks[0].facilities[0].lines.find((l) => l.rid === 1)!;
    expect(lineA1.picked).toBe(5);
    expect(lineA1.nf).toBe(0);

    // A3 is untouched until the picker actually reaches it.
    expect(useStore.getState().tasks[0].facilities[0].lines.find((l) => l.rid === 3)!.picked).toBeUndefined();
  });

  it("records a not-found quantity and reason against the right line", async () => {
    const user = userEvent.setup();
    asRavi();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    await user.click(screen.getByRole("button", { name: "Not found" }));
    await user.click(screen.getByRole("button", { name: "Submit exception" }));

    const lineA1 = useStore.getState().tasks[0].facilities[0].lines.find((l) => l.rid === 1)!;
    expect(lineA1.nf).toBe(5);
    expect(lineA1.picked).toBe(0);
    expect(lineA1.nfReason).toBe("Damaged stock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picker/pickerLineReassignedMidPick.test.tsx`
Expected: FAIL — test 1 fails because after the reassignment the screen shows `A1` again (`queryByText("A1")` is non-null and `A3` is gone); tests 2 and 3 fail because `lineA1.picked` is `undefined` — `applyPicks` has not run yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/PickerView.tsx — replace lines 42-89

  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  // The run, snapshotted once when this picklist is opened — never
  // re-derived from `tasks`. It replaces a plain positional counter (`idx`)
  // that indexed into a list recomputed from live `tasks` on every render
  // and re-sorted by bin (criticalPathSort): a supervisor assigning one more
  // line to this picker mid-shift reshuffled that array under the cursor, so
  // the counter pointed at a different line than the one on screen — the
  // picker was re-shown a line they had already done, the newly added one
  // was never presented, and the run still ended on "Your picking is done".
  // Snapshotting also means a qty edited mid-run doesn't change what the
  // picker was told to take; they pick what was on the screen.
  const [plan, setPlan] = useState<PickLine[]>([]);
  const [nfMap, setNfMap] = useState<Record<number, number>>({});
  const [nfReasonMap, setNfReasonMap] = useState<Record<number, string>>({});
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState<string>(EXCEPTION_REASONS[0]);
  const [nfVal, setNfVal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ facility: string; picked: number; nf: number } | null>(null);

  const chosen = selectedNo ? myLists.find((x) => x.f.no === selectedNo) : undefined;
  const f: FacilityPicklist | undefined = chosen?.f;
  // A line the supervisor has since reassigned away drops out of `mine` —
  // stop asking this picker for it rather than stranding them on it.
  const liveRids = new Set((chosen?.mine ?? []).map((l) => l.rid));
  // Still-unresolved lines, in the order captured when the picklist was
  // opened. Identity (rid), never position, decides what comes next.
  const pending = plan.filter((l) => liveRids.has(l.rid) && !(l.rid in nfMap));
  const line = pending[0];
  const next = pending[1];

  function start(no: string) {
    const entry = myLists.find((x) => x.f.no === no);
    setSelectedNo(no);
    setPlan(entry ? criticalPathSort(entry.mine) : []);
    setNfMap({});
    setNfReasonMap({});
    setExceptionMode(false);
    setDone(null);
  }
  function reset() { setSelectedNo(null); setDone(null); }

  async function advance(nextNf: Record<number, number>, nextReasons: Record<number, string>) {
    setExceptionMode(false);
    if (!f || busy) return;
    setBusy(true);
    try {
      // Persist after EVERY line, not only the last. Results used to sit in
      // React state until the final line was confirmed, so a picker who
      // closed the tab, lost the app, or had their picklist change under them
      // mid-run lost every line they had already walked. applyPicks only
      // touches rids present in `results` and skips lines already resolved
      // (see resolvePickLine), so re-sending the whole accumulated map each
      // time is idempotent — and the facility still only completes on the
      // call that resolves its last open line.
      await applyPicks(f.no, nextNf, nextReasons, myName);
      const remaining = plan.filter((l) => liveRids.has(l.rid) && !(l.rid in nextNf));
      if (remaining.length > 0) return;
      const resolved = plan.filter((l) => l.rid in nextNf);
      const picked = resolved.reduce((s, l) => s + (l.qty - (nextNf[l.rid] ?? 0)), 0);
      const nf = resolved.reduce((s, l) => s + (nextNf[l.rid] ?? 0), 0);
      setDone({ facility: f.facility, picked, nf });
      setSelectedNo(null);
    } finally {
      setBusy(false);
    }
  }
  function picked() {
    if (!line || busy) return; // duplicate-confirm protection: ignore a second tap while the first is still processing
    const next = { ...nfMap, [line.rid]: 0 };
    setNfMap(next);
    void advance(next, nfReasonMap);
  }
  function confirmException() {
    if (!line || busy) return;
    const next = { ...nfMap, [line.rid]: Math.min(Math.max(nfVal, 0), line.qty) };
    const nextReasons = { ...nfReasonMap, [line.rid]: exceptionReason };
    setNfMap(next);
    setNfReasonMap(nextReasons);
    void advance(next, nextReasons);
  }
```

```tsx
// src/components/PickerView.tsx — replace line 135
  const total = plan.length;
  const doneCount = total - pending.length;
```

```tsx
// src/components/PickerView.tsx — replace lines 144-145
      <div className="mb-3 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} /></div>
      <p className="mb-2 text-center text-xs text-slate-500 dark:text-slate-400">Line {Math.min(doneCount + 1, total)} of {total}</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picker`
Expected: PASS — including the existing `pickerFlow.test.tsx`. Note its header comment about avoiding `applyPicks` is now stale: with per-line persistence the first Found tap does call `applyPicks`. Its assertions ("Line 2 of 2", bin A2) still hold, since `doneCount + 1` equals the old `idx + 1`. Update that comment as part of this task.

- [ ] **Step 5: Commit**

```bash
git add tests/picker/pickerLineReassignedMidPick.test.tsx tests/picker/pickerFlow.test.tsx src/components/PickerView.tsx
git commit -m "fix: track picker progress by line identity and persist each line as it is confirmed"
```

---

## Medium

### Task 17: 🚫 BLOCKED — server-side authorization model for `tasks` and `stock_holds` (decision required from Vipul)

**Files:**
- Review only: `supabase/schema_step3_complete.sql:117-136`, `src/components/FacilityBlock.tsx:20`, `src/components/StockHolds.tsx:447`, every `supabase/*.sql`
- No code or SQL is to be written under this task.

**⚠️ DO NOT EXECUTE THIS TASK AUTONOMOUSLY.** It is a business decision about who may do what in a live production warehouse app. A wrong policy locks real operators out mid-shift or silently drops writes. It needs Vipul's explicit choice before anything is written, and it must not be bundled into an "apply the whole plan" run.

**The gap, with evidence**

1. **`tasks` UPDATE is open to every operational role, for the entire row.** `supabase/schema_step3_complete.sql:122-124`:
   ```sql
   create policy "assigned roles update tasks" on tasks for update to authenticated
     using (current_role_name() in ('planner', 'admin', 'super_admin', 'picker'))
     with check (current_role_name() in ('planner', 'admin', 'super_admin', 'picker'));
   ```
   A whole picking task — every facility, every line, gate passes, completion state — lives in one `data` JSONB column, and `updateTaskData` writes that whole column. So any signed-in **picker** can rewrite any task's entire contents, including facilities belonging to other people and other facilities.

2. **The only thing stopping them is a hidden button.** `src/components/FacilityBlock.tsx:20`: `const canDiscard = role === "admin" || role === "super_admin";` gates the Discard and Revoke-WMS-block buttons. `src/components/StockHolds.tsx:447`: `const canRelease = role === "admin" || role === "super_admin";` gates hold release. Both are pure render conditions. The underlying store actions do no role check, and the database accepts the write from any authenticated role.

3. **`stock_holds` has no tracked migration at all — not merely no RLS policy.** Grepping every `supabase/*.sql` for `stock_holds` returns zero hits. There is no `create table`, no `enable row level security`, no policy, and no `supabase_realtime` publication line. The table exists only in the production dashboard; the only reference in the repo is `apps-script/DailyDigestEmail.gs:94`, which reads it with the service key. Whatever RLS it has today is unknown from source and unreproducible into a fresh environment.

**Options to put to Vipul — presented for a decision, not recommended**

- **Option A — Tighten `tasks.update` to admin/super_admin, route picker and planner writes through server-side functions.** Add Postgres RPCs for the two things non-admins legitimately do (record picks for a facility; set a gate pass), each validating the caller and touching only its own slice of `data`. Strongest guarantee; largest change, since `applyPicks`/`setFacilityGatePass`/`assignAll` would stop using `updateTaskData` and every offline-queue path would need rework.
- **Option B — Keep broad UPDATE, add a `before update` trigger enforcing field-level rules.** E.g. only admin/super_admin may flip `discarded`, clear `wmsBlocked`, or change a `completed` facility back to `open`; pickers may only move `picked`/`nf`/`nfReason` on facilities where they are the assigned picker. Much smaller client-side change (nothing moves), but the rules live in PL/pgSQL over a JSONB blob and must be kept in step with the TypeScript model by hand.
- **Option C — Accept the risk, and make the acceptance explicit.** Document that every app user is a trusted, named internal employee on an invite-only tenant, that the UI gates are the intended control, and that the audit log plus `created_by` covers attribution after the fact. Costs nothing and changes nothing; the exposure is that a misconfigured role, a shared login, or a compromised session can silently rewrite production picking data with no server-side stop.

**Independent of whichever option is chosen, one thing should happen regardless** (still Vipul's call to schedule, not to design): commit a `supabase/add_stock_holds_table.sql` that reproduces the live `stock_holds` table — columns, indexes, whatever RLS it currently has — so the schema is in version control. This should be generated from the live database's actual definition, not invented. Task 12 already adds the realtime publication line for it; that migration and this one belong together.

- [ ] **Step 1: Present the three options to Vipul with the evidence above and get an explicit choice in writing.**
- [ ] **Step 2: Dump the live `stock_holds` definition** (`supabase` dashboard → Database → Schema, or `supabase db dump --schema public --table stock_holds`) so the gap between production and the repo is a known quantity before any policy is written.
- [ ] **Step 3: Only after Steps 1 and 2 — open a new, separately-scoped plan for the chosen option.** Do not write policies here.

---

### Task 18: Make the client auto-complete sweep idempotent across devices

**Files:**
- Modify: `src/lib/store.ts:1719-1731` (`checkPicklistAutoComplete`)
- Test: `tests/admin/autoCompleteIdempotent.test.ts`

`checkPicklistAutoComplete` already routes its writes through `saveOwnFacilityChanges` (via `applyPicks`), so it doesn't need the `checkWmsAutoBlock`-style fix from Task 6. The real, remaining defect is that `applyPicks`' "already completed" guard reads **local** state only. Every open browser runs this sweep on its own 60-second timer (`App.tsx:227-228`), so the 2nd..Nth device re-completes a facility the 1st already closed, and `mergeOwnChangesOntoFreshTask` treats it as `ownFacilityNos` and layers that device's duplicate completion — its own `completedAt`, its own internal ref — back over the real one.

**Separate follow-up note, not part of this task:** `supabase/functions/auto-complete-aged-picklists/` already exists and duplicates this logic server-side — consolidating onto it (removing the client-side sweep entirely) would eliminate the redundant-timer problem outright, but requires `supabase functions deploy --no-verify-jwt`, a `CRON_SECRET`, and `CRON.sql` run by hand — none of which is verifiable from this repo, so it's a separate infra decision to raise with Vipul once deployment state is known, not part of this plan.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask } from "../../src/lib/types";

// The auto-complete sweep runs on a 60s interval in EVERY open browser
// (App.tsx), each against its own local `tasks` copy. applyPicks' own
// "already completed" guard only ever sees local state, so the second device
// to tick re-closes a facility the first already closed — and
// saveOwnFacilityChanges treats it as this device's own facility and layers
// the duplicate completion (its own completedAt, its own internal ref) back
// over the real one. Nothing errors; the record just quietly changes hands.
let freshTask: PickingTask | null = null;
const updateTaskData = vi.fn(async () => undefined);
const fetchTaskByNo = vi.fn(async () => freshTask);

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo, updateTaskData, fetchAllTasks: vi.fn(async () => []) };
});

const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

/** This device's stale copy: still open, WMS-blocked, aged past the cutoff. */
function staleLocalTask(): PickingTask {
  return {
    no: "B2BE-BLINKIT-260914-001",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: THREE_DAYS_AGO,
    facilities: [
      {
        no: "B2BE-BLINKIT-260914-001-MH",
        taskNo: "B2BE-BLINKIT-260914-001",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        wmsBlocked: true,
        wmsBlockedAt: THREE_DAYS_AGO,
        gatePassNo: "GPSLMH10888",
        createdAt: THREE_DAYS_AGO,
        lines: [{ rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 20 }],
      },
    ],
  };
}

/** What Supabase actually holds: another device closed it a moment ago. */
function alreadyClosedOnServer(): PickingTask {
  const t = staleLocalTask();
  t.facilities[0] = {
    ...t.facilities[0],
    status: "completed",
    pickedTotal: 20,
    bad: 0,
    gp: "B2BE-BLINKIT-260914-001-MH/061500",
    completedAt: "2026-09-17T06:15:00.000Z",
    lines: [{ ...t.facilities[0].lines[0], picked: 20, nf: 0 }],
  };
  return t;
}

describe("checkPicklistAutoComplete — does not re-close what another device already closed", () => {
  afterEach(() => {
    updateTaskData.mockClear();
    fetchTaskByNo.mockClear();
    freshTask = null;
    vi.resetModules();
  });

  it("skips a facility Supabase already reports completed", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    freshTask = alreadyClosedOnServer();
    useStore.setState({ tasks: [staleLocalTask()], autoCompleteAfterDays: 1, holds: [], stock: [] });

    await useStore.getState().checkPicklistAutoComplete();

    // It looked, and then left the real completion alone.
    expect(fetchTaskByNo).toHaveBeenCalledWith("B2BE-BLINKIT-260914-001");
    expect(updateTaskData).not.toHaveBeenCalled();

    useStore.setState(initialState, true);
  });

  it("still closes a facility that is genuinely still open on the server", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    freshTask = staleLocalTask(); // server agrees it is still open
    useStore.setState({ tasks: [staleLocalTask()], autoCompleteAfterDays: 1, holds: [], stock: [] });

    await useStore.getState().checkPicklistAutoComplete();

    const facility = useStore.getState().tasks[0].facilities[0];
    expect(facility.status).toBe("completed");
    expect(facility.pickedTotal).toBe(20);
    expect(facility.bad).toBe(0);
    expect(updateTaskData).toHaveBeenCalled();

    useStore.setState(initialState, true);
  });

  it("does nothing at all while the timer is off", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    freshTask = staleLocalTask();
    useStore.setState({ tasks: [staleLocalTask()], autoCompleteAfterDays: null, holds: [], stock: [] });

    await useStore.getState().checkPicklistAutoComplete();

    expect(fetchTaskByNo).not.toHaveBeenCalled();
    expect(updateTaskData).not.toHaveBeenCalled();
    expect(useStore.getState().tasks[0].facilities[0].status).toBe("open");

    useStore.setState(initialState, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin/autoCompleteIdempotent.test.ts`
Expected: FAIL on the first test — `fetchTaskByNo` was never called by the sweep itself, and `updateTaskData` **was** called (via `applyPicks` → `saveOwnFacilityChanges`), overwriting the server's real completion. Tests 2 and 3 pass already and guard against over-correcting.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/store.ts — replace lines 1719-1731

      // Recurring version — only runs once Super Admin has actually turned
      // the timer on. Same interval as checkWmsAutoBlock (App.tsx), which
      // means every open browser runs this same sweep independently against
      // its own local `tasks` copy.
      checkPicklistAutoComplete: async () => {
        const days = get().autoCompleteAfterDays;
        if (days == null) return;
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
        const due = dueForAutoComplete(get().tasks, cutoffMs);
        for (const f of due) {
          // applyPicks' own "already completed" guard only sees LOCAL state,
          // so without this the 2nd..Nth device to tick re-closes a facility
          // the 1st already closed — and saveOwnFacilityChanges, treating it
          // as this device's own facility, layers the duplicate completion
          // (its own completedAt and internal ref) over the real one. Nothing
          // errors; the record just quietly changes hands. Confirm against
          // Supabase, not memory, before touching anything.
          if (isSupabaseConfigured) {
            try {
              const fresh = await fetchTaskByNo(f.taskNo);
              const freshFacility = fresh?.facilities.find((x) => x.no === f.no);
              if (!freshFacility || freshFacility.discarded || freshFacility.status === "completed") continue;
            } catch {
              // Couldn't check — skip this facility for this sweep rather
              // than risk a duplicate close. The next tick retries.
              continue;
            }
          }
          const results: Record<number, number> = {};
          for (const l of f.lines) if (l.picked == null) results[l.rid] = 0;
          await get().applyPicks(f.no, results, undefined, "System (auto-complete)");
        }
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin tests/demand/roundTwoAutoCompleteRepro.test.ts tests/repository/cutoffDate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/admin/autoCompleteIdempotent.test.ts src/lib/store.ts
git commit -m "fix: re-check Supabase before auto-completing so parallel device sweeps stop overwriting each other's completions"
```

---

## Low

### Task 19: Globally unique internal reference number

**Files:**
- Modify: `src/lib/store.ts:579`, `:703`, `:1175`, `:1199-1207`, `:1338`, `:1774`
- Test: `tests/demand/internalRefUnique.test.ts`

`gp: "GP-" + String(100000 + gpSeq * 137).slice(0, 6)` is derived from `gpSeq`, a counter that starts at 0 and is persisted to this browser's own localStorage with no cross-device coordination — it's deliberately still persisted when Supabase is configured, unlike tasks/pickers/channels which `partialize` forces empty. Two different browsers completing two unrelated picklists both produce `GP-100137`, shown to operators as **"Internal ref"**. `.no` is a safe replacement source: `tasks.no` is the table's `primary key`, and `buildFacilityLists` appends a facility code plus, for re-offers, a `-R{round}` suffix whose collision case `roundFor` already handles. `gp` is read nowhere but that one display line.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

// The "Internal ref" shown to operators (FacilityBlock.tsx: "Internal ref:
// {f.gp}") was "GP-" + a counter (gpSeq) that starts at 0 and is persisted to
// each browser's OWN localStorage — deliberately kept in partialize even when
// Supabase is configured, unlike tasks/pickers/channels. Nothing coordinates
// it across devices, so the very first picklist any browser completes is
// stamped GP-100137, the second GP-100274, and so on. Two supervisors on two
// machines completing two entirely unrelated picklists hand ops the same
// "internal reference", which then references nothing.
//
// Resetting the whole store between the two completions is exactly what a
// second, different browser looks like: a fresh gpSeq of 0.
function stock(rid: number): StockRow[] {
  return [
    { rid, location: "SL Mother Hub", bin: "A1", sku: "SKU-REF", name: "Product REF", batch: "BA019232", exp: [2099, 1], qty: 100, shelf: 24, type: "Good", active: "Active" },
  ];
}

function task(no: string, rid: number): PickingTask {
  return {
    no,
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      {
        no: `${no}-MH`,
        taskNo: no,
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH10990",
        lines: [{ rid, sku: "SKU-REF", name: "Product REF", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 10 }],
      },
    ],
  };
}

async function completeOn(taskNo: string, rid: number): Promise<string | undefined> {
  useStore.setState(initialState, true); // a different browser: fresh persisted state
  useStore.setState({ stock: stock(rid), skus: { "SKU-REF": { name: "Product REF", shelf: 24 } }, tasks: [task(taskNo, rid)] });
  await useStore.getState().applyPicks(`${taskNo}-MH`, { [rid]: 0 }, undefined, "Supervisor");
  return useStore.getState().tasks[0].facilities[0].gp;
}

describe("internal reference number is globally unique", () => {
  it("two browsers completing two different picklists do not produce the same ref", async () => {
    const refA = await completeOn("B2BE-BLINKIT-260917-001", 1);
    const refB = await completeOn("B2BE-ZEPTO-260917-001", 2);

    expect(refA).toBeDefined();
    expect(refB).toBeDefined();
    expect(refA).not.toBe(refB);
  });

  it("the ref identifies the picklist it belongs to", async () => {
    const ref = await completeOn("B2BE-BLINKIT-260917-007", 1);
    expect(ref).toContain("B2BE-BLINKIT-260917-007-MH");
  });

  it("two rounds of the same task get distinct refs", async () => {
    const refR1 = await completeOn("B2BE-BLINKIT-260917-009", 1);
    // Same task number, different round suffix — buildFacilityLists appends
    // -R{round}, and roundFor() guarantees that suffix is unique per facility.
    useStore.setState(initialState, true);
    useStore.setState({ stock: stock(2), skus: { "SKU-REF": { name: "Product REF", shelf: 24 } }, tasks: [] });
    const t = task("B2BE-BLINKIT-260917-009", 2);
    t.facilities[0] = { ...t.facilities[0], no: "B2BE-BLINKIT-260917-009-MH-R2", round: 2, reofferedFrom: "B2BE-BLINKIT-260917-009-MH" };
    useStore.setState({ tasks: [t] });
    await useStore.getState().applyPicks("B2BE-BLINKIT-260917-009-MH-R2", { 2: 0 }, undefined, "Supervisor");
    const refR2 = useStore.getState().tasks[0].facilities[0].gp;

    expect(refR2).not.toBe(refR1);
    expect(refR2).toContain("-R2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demand/internalRefUnique.test.ts`
Expected: FAIL — all three. Test 1: `refA` and `refB` are both `"GP-100137"`. Test 2: the ref is `"GP-100137"`, containing no picklist number. Test 3: both rounds get `"GP-100137"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/store.ts — replace lines 1197-1207 (inside the completion map)

            const picked = f.lines.reduce((s, l) => s + (l.picked ?? 0), 0);
            const bad = f.lines.reduce((s, l) => s + (l.nf ?? 0), 0);
            const completedAt = new Date().toISOString();
            const finished: FacilityPicklist = {
              ...f,
              status: "completed",
              pickedTotal: picked,
              bad,
              // Internal reference shown to operators (FacilityBlock's
              // "Internal ref"). This used to be "GP-" + a counter (gpSeq)
              // starting at 0 and persisted to each browser's OWN
              // localStorage, with nothing coordinating it across devices —
              // so the first picklist ANY browser completed was stamped
              // GP-100137, and two supervisors on two machines handed ops the
              // same "internal reference" for two unrelated dispatches.
              //
              // Derived now from data that is already guaranteed unique
              // rather than from a new Postgres sequence: `f.no` is the task
              // number (the tasks table's own primary key) plus a facility
              // code plus, for a re-offer, a -R{round} suffix whose
              // uniqueness roundFor() below already enforces. The HHMMSS of
              // completion keeps a re-completion distinguishable from the
              // original.
              gp: `${f.no}/${completedAt.slice(11, 19).replace(/:/g, "")}`,
              completedAt,
            };
```

```ts
// src/lib/store.ts:1175 — delete
        let gpSeq = state.gpSeq;
```

```ts
// src/lib/store.ts:1338 — drop gpSeq from the set()
        set({ tasks, stock, notice: `${facilityNo} updated.${missingRuleNotice}` });
```

```ts
// src/lib/store.ts:579 — delete the AppState field
  gpSeq: number;
```

```ts
// src/lib/store.ts:703 — delete the initial value
      gpSeq: 0,
```

```ts
// src/lib/store.ts:1774 — delete the partialize entry
        gpSeq: s.gpSeq,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npx tsc -b`
Expected: PASS, and TypeScript reports no remaining reference to `gpSeq` (the removal of the `AppState` field is what makes the compiler prove there are none left).

- [ ] **Step 5: Commit**

```bash
git add tests/demand/internalRefUnique.test.ts src/lib/store.ts
git commit -m "fix: derive the internal ref from the picklist number instead of a per-browser counter"
```

---

### Task 20: Hold aging on IST calendar dates, not UTC

**Files:**
- Modify: `src/lib/holds.ts:48-51` (doc), `:77-89`, `:91-101`
- Test: `tests/holds/holdAgeIst.test.ts`

`groupHoldsByFacilityAndDate` uses `h.heldAt.slice(0, 10)` — slicing the stored ISO string, which is already UTC — and `holdAgeDays` slices both `heldAt` and `now.toISOString()`. The doc comments claim "the local calendar date of heldAt" and "matching how a supervisor thinks about it," but this business runs on IST (UTC+5:30). A hold placed between 00:00 and 05:30 IST is filed under the *previous* calendar day and reads a day older than it is — exactly the window the night shift raises not-found holds in.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { groupHoldsByFacilityAndDate, holdAgeDays, holdAgeStatusBadge, holdMatchesAgeBucket, istDateString } from "../../src/lib/holds";
import type { Hold } from "../../src/lib/types";

// This business runs on IST (UTC+5:30). Hold dates and ages were computed by
// slicing the UTC ISO string, despite the docs on both functions saying
// "local calendar date" — so every hold placed between 00:00 and 05:30 IST
// was filed under the PREVIOUS calendar day and reported a day older than it
// is. The night shift is exactly when not-found holds get raised, so this is
// not a rare corner: a hold placed at 02:00 IST on 07 Sep showed under "06
// Sep" and read as 1 day old to a supervisor looking at it that same morning.
//
// The offset is applied explicitly rather than via Date's local-timezone
// methods, so the result does not depend on the timezone the test runner (or
// a picker's phone, or a CI box) happens to be in.
function hold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: 1,
    sku: "SKU-1",
    facility: "SL Mother Hub",
    bin: "R7-C19-002",
    batch: "BA036161",
    qty: 40,
    heldAt: "2026-09-06T20:30:00.000Z", // 02:00 IST on 07 Sep
    heldBy: "Supervisor",
    ...overrides,
  };
}

describe("istDateString", () => {
  it("rolls a late-evening UTC timestamp forward to the next IST day", () => {
    expect(istDateString("2026-09-06T20:30:00.000Z")).toBe("2026-09-07"); // 02:00 IST
    expect(istDateString("2026-09-06T18:30:00.000Z")).toBe("2026-09-07"); // exactly 00:00 IST
    expect(istDateString("2026-09-06T18:29:59.000Z")).toBe("2026-09-06"); // 23:59:59 IST
  });

  it("leaves a mid-day UTC timestamp on the same IST day", () => {
    expect(istDateString("2026-09-06T10:00:00.000Z")).toBe("2026-09-06"); // 15:30 IST
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(istDateString(new Date("2026-09-06T20:30:00.000Z"))).toBe("2026-09-07");
  });
});

describe("groupHoldsByFacilityAndDate — IST calendar dates", () => {
  const order = ["SL Mother Hub", "SL Ambient", "SL RX"];

  it("files a 02:00 IST hold under that IST day, not the previous UTC day", () => {
    const groups = groupHoldsByFacilityAndDate([hold()], order);
    expect(groups[0].dates.map((d) => d.date)).toEqual(["2026-09-07"]);
  });

  it("groups a 23:00 IST hold and a 02:00 IST hold onto their own IST days", () => {
    const holds = [
      hold({ id: 1, heldAt: "2026-09-06T17:30:00.000Z" }), // 23:00 IST, 06 Sep
      hold({ id: 2, heldAt: "2026-09-06T20:30:00.000Z" }), // 02:00 IST, 07 Sep
    ];
    const groups = groupHoldsByFacilityAndDate(holds, order);
    expect(groups[0].dates.map((d) => d.date)).toEqual(["2026-09-07", "2026-09-06"]);
    expect(groups[0].dates[0].holds.map((h) => h.id)).toEqual([2]);
    expect(groups[0].dates[1].holds.map((h) => h.id)).toEqual([1]);
  });
});

describe("holdAgeDays — IST calendar dates", () => {
  it("reads a 02:00 IST hold as 0 days old later that same IST morning", () => {
    // now = 2026-09-07T04:00Z = 09:30 IST on 07 Sep. The hold went on at
    // 02:00 IST the same morning: 0 whole calendar days, not 1.
    expect(holdAgeDays("2026-09-06T20:30:00.000Z", new Date("2026-09-07T04:00:00.000Z"))).toBe(0);
  });

  it("still reads a genuinely-yesterday hold as 1 day old", () => {
    // 23:00 IST on 06 Sep, read at 09:30 IST on 07 Sep.
    expect(holdAgeDays("2026-09-06T17:30:00.000Z", new Date("2026-09-07T04:00:00.000Z"))).toBe(1);
  });

  it("uses the IST day for `now` too, not the UTC one", () => {
    // now = 2026-09-06T19:00Z = 00:30 IST on 07 Sep — the supervisor's
    // calendar has already turned over even though UTC's has not.
    expect(holdAgeDays("2026-09-05T10:00:00.000Z", new Date("2026-09-06T19:00:00.000Z"))).toBe(2);
  });

  it("keeps the age buckets and status badge consistent with the IST age", () => {
    const h = hold(); // 02:00 IST, 07 Sep
    const now = new Date("2026-09-07T04:00:00.000Z"); // 09:30 IST, 07 Sep
    expect(holdMatchesAgeBucket(h, "lt2", now)).toBe(true);
    expect(holdMatchesAgeBucket(h, "2to5", now)).toBe(false);
    expect(holdAgeStatusBadge(holdAgeDays(h.heldAt, now)).label).toBe("Normal SLA (<24h)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/holds/holdAgeIst.test.ts`
Expected: FAIL — `istDateString` is not exported (import is `undefined`, so its three tests throw); the grouping tests get `"2026-09-06"` instead of `"2026-09-07"`; `holdAgeDays` returns `1` where `0` is expected and `1` where `2` is expected.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holds.ts — insert directly above the HoldDateGroup interface (line 48)

/**
 * The IST (UTC+5:30) calendar date of an instant, as "YYYY-MM-DD".
 *
 * This business runs entirely on IST. Hold dates and ages used to be the UTC
 * date — `heldAt.slice(0, 10)` on a timestamp Supabase stores in UTC — so
 * every hold raised between 00:00 and 05:30 IST was filed under the PREVIOUS
 * day and read a day older than it was. The night shift is when not-found
 * holds actually get raised, so that covered a real slice of them: a hold
 * placed at 02:00 IST on 07 Sep displayed under "06 Sep" and showed as 1 day
 * old to the supervisor looking at it that same morning.
 *
 * The offset is added explicitly rather than going through Date's
 * local-timezone methods (getFullYear/getMonth/getDate), so the answer is the
 * same on a picker's phone, a laptop set to another zone, and CI — it never
 * depends on the machine's own timezone.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDateString(at: string | Date): string {
  const ms = (typeof at === "string" ? new Date(at) : at).getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
```

```ts
// src/lib/holds.ts:49 — correct the interface doc
  date: string; // "YYYY-MM-DD", the IST calendar date of heldAt — see istDateString
```

```ts
// src/lib/holds.ts:81 — inside groupHoldsByFacilityAndDate
      const date = istDateString(h.heldAt);
```

```ts
// src/lib/holds.ts — replace holdAgeDays (lines 91-101)

/**
 * Whole IST calendar days between a hold's heldAt and `now` — 0 for "held
 * earlier today", 1 for "held yesterday", etc. Compares calendar dates (not
 * elapsed hours) so a hold placed at 11pm yesterday reads as 1 day old at 9am
 * today, matching how a supervisor thinks about "how old is this" — and both
 * sides are the IST date (see istDateString), so the day boundary falls at
 * midnight IST, not midnight UTC.
 */
export function holdAgeDays(heldAt: string, now: Date): number {
  const heldMs = new Date(istDateString(heldAt) + "T00:00:00Z").getTime();
  const nowMs = new Date(istDateString(now) + "T00:00:00Z").getTime();
  return Math.round((nowMs - heldMs) / 86400000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/holds`
Expected: PASS — including the existing `holds.test.ts`, whose fixtures all sit at 09:00–15:00 UTC (14:30–20:30 IST, same day), so none of its dates or ages shift.

- [ ] **Step 5: Commit**

```bash
git add tests/holds/holdAgeIst.test.ts src/lib/holds.ts
git commit -m "fix: age and group stock holds by the IST calendar date instead of UTC"
```

---

### Task 21: Correct the stale channelRules comment and operator notice

**Files:**
- Modify: `src/lib/store.ts:1215-1222` (comment), `src/lib/store.ts:1229` (user-facing notice)
- Test: none — see Step 1.

**No TDD cycle for this one, deliberately.** Nothing about the program's behaviour changes: this is a code comment plus the wording of a notice string. Writing a test asserting the exact text of an operator-facing message would just pin the copy in place and have to be rewritten the next time someone rephrases it. Verification is a `git diff` read-through plus the existing suite proving nothing else moved.

When Supabase is configured, `partialize` forces `channelRules: {}` rather than persisting it, and `loadChannelOverrides`/`startChannelOverridesRealtime` load `channel_overrides` and subscribe to it live, applying them over the bundled `CHANNELS` defaults. So a channel added or edited in Admin on one device reaches every other device within a realtime tick. The comment says the exact opposite, and the notice tells operators to go re-add it locally.

- [ ] **Step 1: Read the current text and confirm it is stale**

```bash
sed -n '1215,1231p' src/lib/store.ts
sed -n '817,831p' src/lib/store.ts
sed -n '1767,1780p' src/lib/store.ts
```
Expected: the 1215 block claims `channelRules` is localStorage-only and not in Supabase; 817-830 shows it is fetched and subscribed to; 1772-1778 shows `partialize` returning `{}` for it when Supabase is configured. Those three cannot all be true.

- [ ] **Step 2: Apply the copy fix**

```ts
// src/lib/store.ts — replace lines 1215-1222

        // A channel with no rule in `channelRules` at all. Normally that
        // means one genuinely not configured anywhere: when Supabase is
        // configured these come live from channel_overrides layered over the
        // built-in CHANNELS defaults (see loadChannelOverrides /
        // startChannelOverridesRealtime), so an Admin edit or a new channel
        // reaches every device on the next realtime tick — it is NOT a
        // per-browser cache. Only local mode (no Supabase keys) keeps them in
        // this browser's own storage, and a transient fetch failure can also
        // leave a browser briefly short of a rule it should have.
        //
        // Whatever the cause, missing a rule here must never crash the whole
        // completion (it used to: cutoffMonths(undefined, ...) threw, so the
        // entire applyPicks call failed before its set() ever ran — the
        // picklist looked stuck, nothing had actually saved). Skip the
        // not-found re-offer for this channel and say so instead; the
        // completion itself (stock deduction, gate pass, holds) still goes
        // through below.
```

```ts
// src/lib/store.ts — replace line 1229

          missingRuleNotice = ` ⚠ "${parentTask.channel}" has no dispatch rule configured — not-found items weren't auto re-offered. Set one under Admin → Channels (it applies to everyone), then handle this shortfall manually.`;
```

- [ ] **Step 3: Verify by reading the diff**

Run: `git diff src/lib/store.ts`
Expected: exactly two hunks — the comment block and the one notice string. No change to any expression, condition, or control flow. Confirm by eye that the diff contains no `+`/`-` line outside a comment or a string literal.

- [ ] **Step 4: Confirm nothing else moved**

Run: `npx vitest run && npx tsc -b`
Expected: the full suite passes and TypeScript compiles clean. Note `tests/demand/missingChannelRule.test.ts` — if it asserts on the old notice text, update that assertion in this same commit and say so in the message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/demand/missingChannelRule.test.ts
git commit -m "docs: correct the stale claim that channelRules is per-browser localStorage only"
```

---

## Coverage map

| Finding (from the architecture review) | Task(s) |
|---|---|
| 1. CRITICAL — `flushOfflineQueue` silently discards offline picks | Task 1 |
| 2. CRITICAL — stock deducted by stale `rid` | Task 2 |
| 3. CRITICAL — 13 unsafe `updateTaskData` call sites | Tasks 3-8 |
| 4. HIGH — no pagination on `fetchAllTasks`/`fetchHolds`/`fetchGatepassAdherence` | Tasks 9-11 |
| 5. HIGH — no realtime subscription for stock holds | Task 12 |
| 6. HIGH — SupervisorQueue shows discarded/pending rounds as interactive | Task 13 |
| 7. HIGH — gate pass conflict check misses same-batch collisions | Task 14 |
| 8. HIGH — round-2+ exclusion still rid-based | Task 15 |
| 9. MEDIUM — PickerView positional index + late persistence | Task 16 |
| 10. MEDIUM — RLS is UI-only, `stock_holds` untracked | Task 17 (blocked, human decision) |
| 11. MEDIUM — auto-complete sweep runs redundantly on every device | Task 18 |
| 12. LOW — non-unique per-browser gate pass ref numbers | Task 19 |
| 13. LOW — hold aging uses UTC instead of IST | Task 20 |
| 14. LOW — stale channelRules comment/notice | Task 21 |

**Self-review notes:**
- Every finding from the original 14 maps to at least one task; nothing was dropped.
- Task 15 supersedes the `usedRids` code that PR #12 (merged earlier this session) left in place — it does not conflict with that merge, it completes it.
- Task 15's fix was independently implemented and verified (353/353 tests, clean typecheck) before being written into this plan — the highest-confidence task in this document.
- Task 17 is intentionally left without a TDD cycle, by design — it's a decision gate, not an executable fix. Do not let an "execute everything" pass touch it.
- Task 21 is intentionally left without a TDD cycle, by design — it's a text-only correction with nothing behavioral to assert on.
