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
});
