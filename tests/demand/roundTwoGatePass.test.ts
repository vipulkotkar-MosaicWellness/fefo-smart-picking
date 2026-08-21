import { afterEach, describe, expect, it } from "vitest";
import { gatePassPending, useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function stock(): StockRow[] {
  return [
    { rid: 101, location: "SL Mother Hub", bin: "A1", sku: "SKU-R2", name: "Product R2", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 102, location: "SL Mother Hub", bin: "A2", sku: "SKU-R2", name: "Product R2", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
  ];
}

function taskWithGatePass(): PickingTask {
  return {
    no: "TASK-R2",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-R2", qty: 15, gatePassNo: "GPSLMH-9001" }],
    facilities: [
      {
        no: "TASK-R2-MH",
        taskNo: "TASK-R2",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9001",
        lines: [{ rid: 101, sku: "SKU-R2", name: "Product R2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("round-2 (not-found re-offer) gate pass", () => {
  it("inherits the facility's existing round-1 gate pass instead of landing in Gate Pass Allocation Pending", async () => {
    useStore.setState({ stock: stock(), skus: { "SKU-R2": { name: "Product R2", shelf: 24 } }, tasks: [taskWithGatePass()] });

    // Picker finds only 10 of the 15 — 5 not-found triggers a round-2 re-offer.
    await useStore.getState().applyPicks("TASK-R2-MH", { 101: 5 }, { 101: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-R2");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2).toBeDefined();
    expect(r2!.facility).toBe("SL Mother Hub");
    expect(r2!.gatePassNo).toBe("GPSLMH-9001");
    expect(gatePassPending(r2!, updated)).toBe(false);
  });

  it("still falls back to Gate Pass Allocation Pending for a facility round 2 lands on that round 1 never used", async () => {
    const stockRows: StockRow[] = [
      { rid: 201, location: "SL Mother Hub", bin: "A1", sku: "SKU-R2B", name: "Product R2B", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      // Only stock left for the not-found qty is at a facility round 1 never touched.
      { rid: 202, location: "SL Ambient", bin: "C1", sku: "SKU-R2B", name: "Product R2B", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-R2B",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-R2B", qty: 15, gatePassNo: "GPSLMH-9002" }],
      facilities: [
        {
          no: "TASK-R2B-MH",
          taskNo: "TASK-R2B",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-9002",
          lines: [{ rid: 201, sku: "SKU-R2B", name: "Product R2B", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-R2B": { name: "Product R2B", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-R2B-MH", { 201: 5 }, { 201: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-R2B");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2).toBeDefined();
    expect(r2!.facility).toBe("SL Ambient");
    expect(r2!.gatePassNo).toBeUndefined();
    expect(gatePassPending(r2!, updated)).toBe(true);
  });
});
