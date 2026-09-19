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
