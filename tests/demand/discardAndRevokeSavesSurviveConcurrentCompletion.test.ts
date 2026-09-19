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
