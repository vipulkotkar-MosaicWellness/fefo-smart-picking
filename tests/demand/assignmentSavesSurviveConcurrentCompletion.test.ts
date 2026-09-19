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
