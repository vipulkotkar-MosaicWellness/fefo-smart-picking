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
