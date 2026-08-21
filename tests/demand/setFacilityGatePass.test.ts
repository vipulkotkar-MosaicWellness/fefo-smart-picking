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
});
