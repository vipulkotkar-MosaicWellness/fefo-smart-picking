// tests/demand/caseSizesInAllocation.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — respects caseSizes when allocating", () => {
  it("produces a case+each split when the SKU has a configured case size", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-CS", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-CS": { name: "Product", shelf: 24 } },
      caseSizes: { "SKU-CS": 30 },
      tasks: [],
    });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-CS", qty: 200, gatePassNo: "GP-CS-1" }]);

    await useStore.getState().generate(null, "Tester");

    const task = useStore.getState().tasks.find((t) => t.channel === CHANNEL)!;
    const line = task.facilities[0].lines[0];
    expect(line.caseQty).toBe(180);
    expect(line.eachQty).toBe(20);
    expect(line.qty).toBe(200);
  });

  it("a SKU with no configured case size still allocates plain FEFO, unchanged", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-NOCASE", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-NOCASE": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-CS": 30 }, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-NOCASE", qty: 200, gatePassNo: "GP-CS-2" }]);

    await useStore.getState().generate(null, "Tester");

    const task = useStore.getState().tasks.find((t) => t.channel === CHANNEL)!;
    const line = task.facilities[0].lines[0];
    expect(line.qty).toBe(200);
    expect(line.caseQty).toBeUndefined();
    expect(line.eachQty).toBeUndefined();
  });
});

describe("applyPicks — round-2 re-offer also respects caseSizes", () => {
  it("a not-found re-offer for a SKU with a configured case size gets its own case+each split", async () => {
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-CS-R2", name: "Product", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    const task: PickingTask = {
      no: "TASK-CS-R2",
      channel: CHANNEL,
      demand: [{ channel: CHANNEL, sku: "SKU-CS-R2", qty: 200, gatePassNo: "GP-CS-R2" }],
      facilities: [
        {
          no: "TASK-CS-R2-MH", taskNo: "TASK-CS-R2", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-CS-R2",
          lines: [{ rid: 99, sku: "SKU-CS-R2", name: "Product", facility: "SL Mother Hub", bin: "Z1", batch: "OLD", exp: [2099, 1], rem: 900, qty: 200 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock, skus: { "SKU-CS-R2": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-CS-R2": 30 }, tasks: [task] });

    await useStore.getState().applyPicks("TASK-CS-R2-MH", { 99: 200 }, { 99: "Batch mismatch" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-CS-R2")!;
    const round2 = updated.facilities.find((f) => f.round === 2)!;
    expect(round2.lines[0].caseQty).toBe(180);
    expect(round2.lines[0].eachQty).toBe(20);
  });
});
