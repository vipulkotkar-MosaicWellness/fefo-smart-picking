import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

function pendingTask(overrides: Partial<PickingTask["facilities"][number]> = {}): PickingTask {
  return {
    no: "TASK-PENDING",
    gatePassNo: undefined,
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      { no: "TASK-PENDING-MH", taskNo: "TASK-PENDING", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [], ...overrides },
    ],
  };
}

function releasedTask(overrides: Partial<PickingTask["facilities"][number]> = {}): PickingTask {
  return {
    no: "TASK-RELEASED",
    gatePassNo: "GPSLMH-1001",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      { no: "TASK-RELEASED-MH", taskNo: "TASK-RELEASED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [], ...overrides },
    ],
  };
}

describe("discardFacilityPicklist — spurious WMS block on a gate-pass-pending facility", () => {
  it("discards a WMS-blocked but still gate-pass-pending facility in one transaction, auto-revoking the block", async () => {
    useStore.setState({ tasks: [pendingTask({ wmsBlocked: true })] });
    await useStore.getState().discardFacilityPicklist("TASK-PENDING", "TASK-PENDING-MH", "Vipul Kotkar");
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.discarded).toBe(true);
    expect(f.wmsBlocked).toBe(false);
    expect(f.wmsRevokedBy).toBe("Vipul Kotkar");
    expect(f.wmsRevokedAt).toBeDefined();
  });

  it("falls back to a system-authored revoke note when no revokedBy is passed", async () => {
    useStore.setState({ tasks: [pendingTask({ wmsBlocked: true })] });
    await useStore.getState().discardFacilityPicklist("TASK-PENDING", "TASK-PENDING-MH");
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.discarded).toBe(true);
    expect(f.wmsBlocked).toBe(false);
    expect(f.wmsRevokedBy).toMatch(/System/);
  });

  it("still hard-stops a WMS block on a facility that HAS a gate pass — that block may be a real external reservation", async () => {
    useStore.setState({ tasks: [releasedTask({ wmsBlocked: true })] });
    await useStore.getState().discardFacilityPicklist("TASK-RELEASED", "TASK-RELEASED-MH", "Vipul Kotkar");
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.discarded).toBeUndefined();
    expect(f.wmsBlocked).toBe(true);
    expect(useStore.getState().notice).toMatch(/Revoke the WMS block first/);
  });

  it("discards a non-blocked pending facility exactly as before", async () => {
    useStore.setState({ tasks: [pendingTask()] });
    await useStore.getState().discardFacilityPicklist("TASK-PENDING", "TASK-PENDING-MH");
    const f = useStore.getState().tasks[0].facilities[0];
    expect(f.discarded).toBe(true);
    expect(f.wmsRevokedBy).toBeUndefined();
  });
});
