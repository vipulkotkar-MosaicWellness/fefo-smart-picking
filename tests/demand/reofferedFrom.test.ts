import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("reofferedFrom", () => {
  it("stamps the originating facility's .no onto a round-2 re-offer that lands on a DIFFERENT facility", async () => {
    const stockRows: StockRow[] = [
      { rid: 301, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO", name: "Product RO", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      // Only stock left for the not-found qty is at a facility round 1 never touched.
      { rid: 302, location: "SL Ambient", bin: "C1", sku: "SKU-RO", name: "Product RO", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO", qty: 15, gatePassNo: "GPSLMH-RO1" }],
      facilities: [
        {
          no: "TASK-RO-MH",
          taskNo: "TASK-RO",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO1",
          lines: [{ rid: 301, sku: "SKU-RO", name: "Product RO", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO": { name: "Product RO", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-RO-MH", { 301: 5 }, { 301: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-RO");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2).toBeDefined();
    expect(r2!.facility).toBe("SL Ambient"); // confirms it DID land on a different facility
    expect(r2!.reofferedFrom).toBe("TASK-RO-MH");
  });

  it("also stamps it for a same-facility re-offer, not just the cross-facility case", async () => {
    const stockRows: StockRow[] = [
      { rid: 401, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO2", name: "Product RO2", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      { rid: 402, location: "SL Mother Hub", bin: "A2", sku: "SKU-RO2", name: "Product RO2", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO2",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO2", qty: 15, gatePassNo: "GPSLMH-RO2" }],
      facilities: [
        {
          no: "TASK-RO2-MH",
          taskNo: "TASK-RO2",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO2",
          lines: [{ rid: 401, sku: "SKU-RO2", name: "Product RO2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO2": { name: "Product RO2", shelf: 24 } }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-RO2-MH", { 401: 5 }, { 401: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-RO2");
    const r2 = updated?.facilities.find((f) => f.round === 2);

    expect(r2!.facility).toBe("SL Mother Hub");
    expect(r2!.reofferedFrom).toBe("TASK-RO2-MH");
  });

  it("round 1 itself has no reofferedFrom", async () => {
    const stockRows: StockRow[] = [
      { rid: 501, location: "SL Mother Hub", bin: "A1", sku: "SKU-RO3", name: "Product RO3", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-RO3",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-RO3", qty: 15, gatePassNo: "GPSLMH-RO3" }],
      facilities: [
        {
          no: "TASK-RO3-MH",
          taskNo: "TASK-RO3",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-RO3",
          lines: [{ rid: 501, sku: "SKU-RO3", name: "Product RO3", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock: stockRows, skus: { "SKU-RO3": { name: "Product RO3", shelf: 24 } }, tasks: [task] });

    const round1 = useStore.getState().tasks[0].facilities[0];
    expect(round1.reofferedFrom).toBeUndefined();
  });
});
