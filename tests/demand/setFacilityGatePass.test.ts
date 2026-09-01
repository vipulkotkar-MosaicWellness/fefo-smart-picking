import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

function pendingTask(): PickingTask {
  return {
    no: "TASK-PENDING",
    gatePassNo: undefined,
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      { no: "TASK-PENDING-MH", taskNo: "TASK-PENDING", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] },
    ],
  };
}

describe("setFacilityGatePass", () => {
  it("rejects a gate pass whose prefix doesn't match the facility, without changing anything", async () => {
    useStore.setState({ tasks: [pendingTask()] });
    const result = await useStore.getState().setFacilityGatePass("TASK-PENDING", "TASK-PENDING-MH", "GPSLAMB-1001");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GPSLMH/);
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.gatePassNo).toBeUndefined();
  });

  it("rejects an empty gate pass", async () => {
    useStore.setState({ tasks: [pendingTask()] });
    const result = await useStore.getState().setFacilityGatePass("TASK-PENDING", "TASK-PENDING-MH", "   ");
    expect(result.ok).toBe(false);
  });

  it("accepts a matching gate pass and sets it on the facility", async () => {
    useStore.setState({ tasks: [pendingTask()] });
    const result = await useStore.getState().setFacilityGatePass("TASK-PENDING", "TASK-PENDING-MH", "GPSLMH-1001");
    expect(result.ok).toBe(true);
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.gatePassNo).toBe("GPSLMH-1001");
  });

  it("returns an error for a picklist that doesn't exist", async () => {
    useStore.setState({ tasks: [] });
    const result = await useStore.getState().setFacilityGatePass("NOPE", "NOPE-MH", "GPSLMH-1001");
    expect(result.ok).toBe(false);
  });

  // Real cases this session: GPSLAMB27789 and GPSLMH9820, both a gate pass
  // number copy-pasted or retyped from one real order straight into an
  // unrelated second one — nothing blocked it, so the second order silently
  // "disappeared" behind the first one's already-claimed number.
  describe("rejects a gate pass already claimed by a different, unrelated order", () => {
    function otherTaskWithGatePass(): PickingTask {
      return {
        no: "TASK-OTHER",
        channel: "Blinkit",
        demand: [],
        shortfall: [],
        createdAt: new Date().toISOString(),
        facilities: [
          { no: "TASK-OTHER-MH", taskNo: "TASK-OTHER", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GPSLMH-DUPE", lines: [] },
        ],
      };
    }

    it("blocks it and names exactly which other order already has it", async () => {
      useStore.setState({ tasks: [pendingTask(), otherTaskWithGatePass()] });
      const result = await useStore.getState().setFacilityGatePass("TASK-PENDING", "TASK-PENDING-MH", "GPSLMH-DUPE");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/TASK-OTHER/);
      expect(result.error).toMatch(/TASK-OTHER-MH/);
      // Nothing changed on the picklist that tried to claim it.
      expect(useStore.getState().tasks.find((t) => t.no === "TASK-PENDING")!.facilities[0].gatePassNo).toBeUndefined();
    });

    it("still allows the SAME gate pass to be reused across a different round of its OWN task", async () => {
      const task: PickingTask = {
        no: "TASK-SAMETASK",
        channel: "Blinkit",
        demand: [],
        shortfall: [],
        createdAt: new Date().toISOString(),
        facilities: [
          { no: "TASK-SAMETASK-MH", taskNo: "TASK-SAMETASK", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0, gatePassNo: "GPSLMH-REUSE", lines: [] },
          { no: "TASK-SAMETASK-MH-R2", taskNo: "TASK-SAMETASK", facility: "SL Mother Hub", status: "open", round: 2, bad: 0, lines: [] },
        ],
      };
      useStore.setState({ tasks: [task] });
      const result = await useStore.getState().setFacilityGatePass("TASK-SAMETASK", "TASK-SAMETASK-MH-R2", "GPSLMH-REUSE");
      expect(result.ok).toBe(true);
      expect(useStore.getState().tasks[0].facilities[1].gatePassNo).toBe("GPSLMH-REUSE");
    });

    it("a discarded facility's old gate pass number is free to reuse elsewhere", async () => {
      const discarded = otherTaskWithGatePass();
      discarded.facilities[0].discarded = true;
      useStore.setState({ tasks: [pendingTask(), discarded] });
      const result = await useStore.getState().setFacilityGatePass("TASK-PENDING", "TASK-PENDING-MH", "GPSLMH-DUPE");
      expect(result.ok).toBe(true);
    });
  });
});
