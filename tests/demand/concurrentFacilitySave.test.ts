import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask, StockRow } from "../../src/lib/types";

// applyPicks' save step must survive a sibling facility on the same task
// having been completed by someone else, in Supabase, in the moments
// between this device's last read and this device's own save — see
// mergeOwnChangesOntoFreshTask in store.ts. Mocking fetchTaskByNo lets this
// test simulate exactly that race deterministically, instead of depending
// on real network timing.
vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchTaskByNo: vi.fn(), updateTaskData: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("applyPicks — concurrent-save safety", () => {
  afterEach(() => vi.resetModules());

  it("does not clobber a sibling facility that was completed by someone else in the meantime", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const task: PickingTask = {
      no: "TASK-RACE",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RACE", qty: 5, gatePassNo: "GP-MH" }],
      facilities: [
        {
          no: "TASK-RACE-MH", taskNo: "TASK-RACE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-MH",
          lines: [{ rid: 901, sku: "SKU-RACE", name: "Race product", facility: "SL Mother Hub", bin: "M1", batch: "B1", exp: [2099, 1], rem: 900, qty: 5 }],
        },
        // AMB is still "open" in THIS device's local copy...
        { no: "TASK-RACE-AMB", taskNo: "TASK-RACE", facility: "SL Ambient", status: "open", round: 1, bad: 0, gatePassNo: "GP-AMB", lines: [] },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };

    // ...but the database's current copy shows someone else already
    // completed AMB, moments ago, on a different device.
    const freshFromServer: PickingTask = {
      ...task,
      facilities: [
        task.facilities[0], // MH unchanged server-side — this device is about to complete it
        { ...task.facilities[1], status: "completed", pickedTotal: 12, bad: 0 },
      ],
    };
    vi.mocked(tasksSupabase.fetchTaskByNo).mockResolvedValue(freshFromServer);

    const stock: StockRow[] = [
      { rid: 901, location: "SL Mother Hub", bin: "M1", sku: "SKU-RACE", name: "Race product", batch: "B1", exp: [2099, 1], qty: 5, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-RACE": { name: "Race product", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-RACE-MH", { 901: 0 }, {}, "Tester");

    expect(tasksSupabase.fetchTaskByNo).toHaveBeenCalledWith("TASK-RACE");
    const savedTask = vi.mocked(tasksSupabase.updateTaskData).mock.calls.at(-1)?.[0] as PickingTask;
    const savedMh = savedTask.facilities.find((f) => f.no === "TASK-RACE-MH");
    const savedAmb = savedTask.facilities.find((f) => f.no === "TASK-RACE-AMB");

    expect(savedMh?.status).toBe("completed"); // this device's own completion went through
    expect(savedMh?.pickedTotal).toBe(5);
    expect(savedAmb?.status).toBe("completed"); // the OTHER device's completion survived
    expect(savedAmb?.pickedTotal).toBe(12); // not clobbered back to this device's stale "open" copy

    useStore.setState(initialState, true);
  });
});
