import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// LOT-A is the lot this picklist line is actually about (same sku/facility/
// bin/batch), but its remembered rid (999) is stale — a resync since this
// line was created reassigned rid 999 to a completely unrelated lot,
// LOT-B, at a different facility. Real production risk: picklists are
// generated on one device's stock snapshot and completed on another's.
function stock(): StockRow[] {
  return [
    { rid: 501, location: "SL Mother Hub", bin: "M1", sku: "SKU-DED", name: "Product DED", batch: "BATCH-A", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 999, location: "SL RX", bin: "R1", sku: "SKU-UNRELATED", name: "Unrelated product", batch: "BATCH-U", exp: [2099, 1], qty: 15, shelf: 24, type: "Good", active: "Active" },
  ];
}

function task(): PickingTask {
  return {
    no: "TASK-DED",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-DED", qty: 8, gatePassNo: "GP-DED" }],
    facilities: [
      {
        no: "TASK-DED-MH", taskNo: "TASK-DED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GP-DED",
        // rid 999 is stale — the line really refers to LOT-A (Mother Hub /
        // M1 / BATCH-A), but its remembered rid now matches LOT-B's current rid.
        lines: [{ rid: 999, sku: "SKU-DED", name: "Product DED", facility: "SL Mother Hub", bin: "M1", batch: "BATCH-A", exp: [2099, 1], rem: 900, qty: 8 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("applyPicks — stock deduction matches by lot identity, not stale rid", () => {
  it("deducts from the lot the line actually refers to, and leaves the unrelated rid-colliding lot untouched", async () => {
    useStore.setState({ stock: stock(), skus: { "SKU-DED": { name: "Product DED", shelf: 24 } }, tasks: [task()] });

    await useStore.getState().applyPicks("TASK-DED-MH", { 999: 0 }, {}, "Tester");

    const updatedStock = useStore.getState().stock;
    const lotA = updatedStock.find((b) => b.bin === "M1" && b.batch === "BATCH-A")!;
    const lotB = updatedStock.find((b) => b.bin === "R1" && b.batch === "BATCH-U")!;

    expect(lotA.qty).toBe(12); // 20 - 8 picked, deducted from the RIGHT lot
    expect(lotB.qty).toBe(15); // untouched — the rid collision must not affect it
  });
});
