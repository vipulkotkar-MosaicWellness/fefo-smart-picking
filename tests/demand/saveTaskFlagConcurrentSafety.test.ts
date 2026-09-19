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
