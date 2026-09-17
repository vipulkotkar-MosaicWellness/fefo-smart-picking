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
  // vi.resetModules() alone re-initializes the store singleton fresh for
  // each test, but it does NOT clear a mocked module's call history —
  // tasksSupabase.updateTaskData would otherwise still show the previous
  // test's call recorded when the next test checks it.
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

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

  // The more common real-world trigger: connectivity blips and comes back
  // in the SAME browser tab (no reload) — App.tsx's `online` listener fires
  // flushOfflineQueue() directly. In this case `tasks` still holds the
  // facility as already locally "completed" from the original offline
  // attempt (that's WHY it's in the queue at all): resolvePickLine no-ops
  // on every already-resolved line, the facility is already "completed" so
  // applyPicks' own completion block never runs, and applyPicks' internal
  // save never fires. Without an explicit save after replaying applyPicks,
  // flushOfflineQueue would dequeue the item, do nothing, and still report
  // "✓ Synced" — the exact silent-drop bug this file exists to catch.
  it("still reaches Supabase on a same-session retry, where the facility is already completed locally", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const { enqueue, loadQueue } = await import("../../src/lib/offlineQueue");
    const initialState = useStore.getState();

    // This device's local state: the facility already transitioned to
    // "completed" during the original (failed-to-save) applyPicks call.
    const locallyCompletedTask: PickingTask = {
      no: "TASK-RETRY",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RETRY", qty: 10, gatePassNo: "GP-RETRY" }],
      facilities: [
        {
          no: "TASK-RETRY-MH", taskNo: "TASK-RETRY", facility: "SL Mother Hub", status: "completed", round: 1, bad: 3, gatePassNo: "GP-RETRY",
          pickedTotal: 7, gp: "GP-100137", completedAt: new Date().toISOString(),
          lines: [{ rid: 601, sku: "SKU-RETRY", name: "Retry product", facility: "SL Mother Hub", bin: "M2", batch: "B2", exp: [2099, 1], rem: 900, qty: 10, picked: 7, nf: 3, nfReason: "Damaged stock" }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    // The server's copy is still stale/open — the original save never went through.
    const freshFromServer: PickingTask = {
      ...locallyCompletedTask,
      facilities: [{ ...locallyCompletedTask.facilities[0], status: "open", bad: 0, pickedTotal: undefined, gp: undefined, completedAt: undefined, lines: [{ ...locallyCompletedTask.facilities[0].lines[0], picked: undefined, nf: undefined, nfReason: undefined }] }],
    };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);
    useStore.setState({ tasks: [locallyCompletedTask], tasksLoaded: true });

    enqueue({ facilityNo: "TASK-RETRY-MH", results: { 601: 3 }, reasons: { 601: "Damaged stock" }, heldBy: "Night Picker" });

    await useStore.getState().flushOfflineQueue();

    // Not zero calls — applyPicks itself made none (no completion transition
    // fired this round), so this call can only be the explicit follow-up save.
    expect(tasksSupabase.updateTaskData).toHaveBeenCalledTimes(1);
    const savedTask = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedLine = savedTask.facilities[0].lines[0];
    expect(savedLine.picked).toBe(7);
    expect(savedLine.nf).toBe(3);
    // Empty because it was actually saved — not because the item was dropped.
    expect(loadQueue()).toHaveLength(0);

    useStore.setState(initialState, true);
  });

  it("re-queues the item (never silently drops it) when the same-session retry save still fails", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const { enqueue, loadQueue } = await import("../../src/lib/offlineQueue");
    const initialState = useStore.getState();

    const locallyCompletedTask: PickingTask = {
      no: "TASK-RETRY-FAIL",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RETRY-FAIL", qty: 10, gatePassNo: "GP-RETRY-FAIL" }],
      facilities: [
        {
          no: "TASK-RETRY-FAIL-MH", taskNo: "TASK-RETRY-FAIL", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0, gatePassNo: "GP-RETRY-FAIL",
          pickedTotal: 10, gp: "GP-100274", completedAt: new Date().toISOString(),
          lines: [{ rid: 701, sku: "SKU-RETRY-FAIL", name: "Retry-fail product", facility: "SL Mother Hub", bin: "M3", batch: "B3", exp: [2099, 1], rem: 900, qty: 10, picked: 10, nf: 0 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    // Still offline / still failing — the retry's own save attempt errors too.
    vi.mocked(tasksSupabase.fetchTaskByNo).mockRejectedValue(new Error("network unreachable"));
    useStore.setState({ tasks: [locallyCompletedTask], tasksLoaded: true });

    enqueue({ facilityNo: "TASK-RETRY-FAIL-MH", results: { 701: 0 }, reasons: {}, heldBy: "Night Picker" });

    await useStore.getState().flushOfflineQueue();

    expect(tasksSupabase.updateTaskData).not.toHaveBeenCalled();
    // Re-queued, not dropped — the picker's result is still safe for the next retry.
    const queued = loadQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].facilityNo).toBe("TASK-RETRY-FAIL-MH");
    expect(queued[0].results).toEqual({ 701: 0 });
    // Must not falsely report success when nothing actually saved.
    expect(useStore.getState().notice).not.toMatch(/Synced/);

    useStore.setState(initialState, true);
  });

  // Reload-then-replay where BOTH save attempts fail: applyPicks' own
  // internal save (the completion transition genuinely fires this round,
  // since `tasks` is a freshly-reloaded, still-unpicked copy) fails and
  // re-queues via its own catch block, and flushOfflineQueue's unconditional
  // explicit follow-up save then ALSO fails and would re-queue a second time
  // if it didn't check for the entry applyPicks already left behind first.
  it("does not double-enqueue when applyPicks' own save and the explicit follow-up save both fail", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const { enqueue, loadQueue } = await import("../../src/lib/offlineQueue");
    const initialState = useStore.getState();

    const freshTask: PickingTask = {
      no: "TASK-DUP",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-DUP", qty: 10, gatePassNo: "GP-DUP" }],
      facilities: [
        {
          no: "TASK-DUP-MH", taskNo: "TASK-DUP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-DUP",
          lines: [{ rid: 801, sku: "SKU-DUP", name: "Dup product", facility: "SL Mother Hub", bin: "M4", batch: "B4", exp: [2099, 1], rem: 900, qty: 10 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    // Still offline throughout this whole flush pass — every save attempt
    // (applyPicks' internal one and flushOfflineQueue's explicit follow-up)
    // fails the same way.
    vi.mocked(tasksSupabase.fetchTaskByNo).mockRejectedValue(new Error("network unreachable"));
    useStore.setState({
      tasks: [freshTask],
      tasksLoaded: true,
      stock: [{ rid: 801, location: "SL Mother Hub", bin: "M4", sku: "SKU-DUP", name: "Dup product", batch: "B4", exp: [2099, 1], qty: 10, shelf: 24, type: "Good", active: "Active" }],
      skus: { "SKU-DUP": { name: "Dup product", shelf: 24 } },
    });

    enqueue({ facilityNo: "TASK-DUP-MH", results: { 801: 0 }, reasons: {}, heldBy: "Night Picker" });

    await useStore.getState().flushOfflineQueue();

    // Exactly one entry for this facility — not two, even though both the
    // internal and the explicit follow-up save failed in the same pass.
    const queued = loadQueue().filter((q) => q.facilityNo === "TASK-DUP-MH");
    expect(queued).toHaveLength(1);

    useStore.setState(initialState, true);
  });
});
