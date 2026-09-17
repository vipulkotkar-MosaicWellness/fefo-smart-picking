import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// Two lots of the same SKU at the same facility, both eligible — BIN-A is the
// earlier-expiring lot (so pure-FEFO would normally prefer it every time) and
// BIN-B is the fallback the re-offer should land on once BIN-A has just come
// back not-found.
//
// BIN-A's rid here (501) is deliberately a FRESH one, standing in for "stock
// was resynced after round 1's line was created" — rids are reassigned on
// every resync (see rowsFromTuples), so a picklist line created earlier holds
// onto whatever rid its lot had back then, which can easily no longer match
// that lot's rid in the current `stock` snapshot by the time it's completed.
function stock(): StockRow[] {
  return [
    { rid: 501, location: "SL Mother Hub", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 1], qty: 81, shelf: 24, type: "Good", active: "Active" },
    { rid: 502, location: "SL Mother Hub", bin: "BIN-B", sku: "SKU-NF", name: "Product NF", batch: "BATCH-B", exp: [2099, 2], qty: 81, shelf: 24, type: "Good", active: "Active" },
  ];
}

// Round 1's line still carries rid 999 — the (now-stale) id BIN-A's lot had
// when this line was originally created, before the resync above reassigned
// it to 501. Same real bin+batch, different remembered rid.
function task(): PickingTask {
  return {
    no: "TASK-NF",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-NF", qty: 81, gatePassNo: "GPSLMH-9101" }],
    facilities: [
      {
        no: "TASK-NF-MH",
        taskNo: "TASK-NF",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9101",
        lines: [{ rid: 999, sku: "SKU-NF", name: "Product NF", facility: "SL Mother Hub", bin: "BIN-A", batch: "BATCH-A", exp: [2099, 1], rem: 900, qty: 81 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

// Mirrors a real production case (GPSLMH10477): round 1 came back fully
// not-found ("Batch mismatch") on BIN-A/BATCH-A. The auto re-offer's own
// duplicate-avoidance (`usedRids`, matched against the CURRENT stock
// snapshot's rid) missed it because round 1's line was still carrying the
// rid its lot had at creation time (999), not the rid a later resync gave
// that same lot in the fresh `stock` array (501) — so the exclusion silently
// matched nothing, and round 2 landed right back on BIN-A. It then failed
// for the same reason, wasting a whole cycle before round 3 finally moved to
// a different lot.
describe("not-found re-offer avoids the bin+batch that just failed", () => {
  it("sends round 2 to a different bin+batch than the one round 1 just reported not-found, even when round 1's remembered rid is stale", async () => {
    useStore.setState({ stock: stock(), skus: { "SKU-NF": { name: "Product NF", shelf: 24 } }, tasks: [task()] });

    await useStore.getState().applyPicks("TASK-NF-MH", { 999: 81 }, { 999: "Batch mismatch" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF");
    const round1 = updated!.facilities.find((f) => f.round === 1)!;
    expect(round1.lines[0].nf).toBe(81);

    const round2 = updated!.facilities.find((f) => f.round === 2);
    expect(round2).toBeDefined();
    expect(round2!.lines[0].qty).toBe(81);
    expect(round2!.lines[0].bin).toBe("BIN-B");
    expect(round2!.lines[0].batch).toBe("BATCH-B");
    expect(round2!.lines[0].bin).not.toBe(round1.lines[0].bin);
  });
});
