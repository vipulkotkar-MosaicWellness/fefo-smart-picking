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
        // No gatePassNo here on purpose: this device still sees Ambient as
        // "gate pass allocation pending" (dueForWmsBlock excludes it via
        // gatePassPending), so from this device's own stale local view it's
        // not part of the sweep at all -- isolating the scenario this test
        // actually means to prove (Mother Hub's own sweep write must not
        // clobber a completion that happened elsewhere on a DIFFERENT
        // facility this device isn't touching), rather than conflating it
        // with the separate case of two facilities racing on the same sweep.
        { no: "TASK-SWEEP-AMB", taskNo: "TASK-SWEEP", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [], createdAt },
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
