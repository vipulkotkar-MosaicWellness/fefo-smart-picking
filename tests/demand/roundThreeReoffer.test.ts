import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function stock(): StockRow[] {
  return [
    { rid: 301, location: "SL Mother Hub", bin: "A1", sku: "SKU-R3", name: "Product R3", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 302, location: "SL Mother Hub", bin: "A2", sku: "SKU-R3", name: "Product R3", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 303, location: "SL Mother Hub", bin: "A3", sku: "SKU-R3", name: "Product R3", batch: "B3", exp: [2099, 3], qty: 20, shelf: 24, type: "Good", active: "Active" },
  ];
}

function task(): PickingTask {
  return {
    no: "TASK-R3",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-R3", qty: 15, gatePassNo: "GPSLMH-9003" }],
    facilities: [
      {
        no: "TASK-R3-MH",
        taskNo: "TASK-R3",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9003",
        lines: [{ rid: 301, sku: "SKU-R3", name: "Product R3", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("round-3+ (a second not-found event on an already-round-2 facility)", () => {
  it("creates a distinct round-3 facility instead of colliding with the round-2 facility's own `no`", async () => {
    useStore.setState({ stock: stock(), skus: { "SKU-R3": { name: "Product R3", shelf: 24 } }, tasks: [task()] });

    // Round 1: 5 of 15 not-found -> round 2 created, per existing behavior.
    await useStore.getState().applyPicks("TASK-R3-MH", { 301: 5 }, { 301: "Damaged stock" }, "Tester");
    let updated = useStore.getState().tasks.find((t) => t.no === "TASK-R3");
    const round2 = updated?.facilities.find((f) => f.round === 2);
    expect(round2).toBeDefined();
    expect(round2!.no).toBe("TASK-R3-MH-R2");
    expect(round2!.lines[0].qty).toBe(5);

    // Round 2 itself now comes up 2 short -> this used to hardcode round=2/"-R2"
    // again, colliding with round2's own `no` instead of making a real round 3.
    await useStore.getState().applyPicks(round2!.no, { [round2!.lines[0].rid]: 2 }, { [round2!.lines[0].rid]: "Damaged stock" }, "Tester");
    updated = useStore.getState().tasks.find((t) => t.no === "TASK-R3");

    const allNos = updated!.facilities.map((f) => f.no);
    expect(new Set(allNos).size).toBe(allNos.length); // no duplicate `no` anywhere on the task

    const round2After = updated!.facilities.find((f) => f.no === "TASK-R3-MH-R2");
    const round3 = updated!.facilities.find((f) => f.round === 3);

    expect(round2After!.status).toBe("completed"); // the completed round-2 record is untouched, not overwritten
    expect(round3).toBeDefined();
    expect(round3!.no).toBe("TASK-R3-MH-R3");
    expect(round3!.no).not.toBe(round2!.no);
    expect(round3!.lines[0].qty).toBe(2);
    expect(round3!.status).toBe("open");
  });
});
