import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// Three lots of the same SKU at the same facility, all eligible, sorted FEFO
// BIN-A < BIN-B < BIN-C. rids below are whatever the CURRENT stock resync
// happens to have assigned them "right now" — deliberately disjoint from any
// rid a still-open or already-completed picklist line remembers, standing in
// for "stock has been resynced (rids reassigned) since that line was made."
function stock(rids: [number, number, number]): StockRow[] {
  return [
    { rid: rids[0], location: "SL Mother Hub", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 1], qty: 81, shelf: 24, type: "Good", active: "Active" },
    { rid: rids[1], location: "SL Mother Hub", bin: "BIN-B", sku: "SKU-NF", name: "Product NF", batch: "BATCH-B", exp: [2099, 2], qty: 81, shelf: 24, type: "Good", active: "Active" },
    { rid: rids[2], location: "SL Mother Hub", bin: "BIN-C", sku: "SKU-NF", name: "Product NF", batch: "BATCH-C", exp: [2099, 3], qty: 81, shelf: 24, type: "Good", active: "Active" },
  ];
}

function taskWithRound1(rid: number): PickingTask {
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
        lines: [{ rid, sku: "SKU-NF", name: "Product NF", facility: "SL Mother Hub", bin: "BIN-A", batch: "BATCH-A", exp: [2099, 1], rem: 900, qty: 81 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

// Mirrors a real production shape: round 1 fails on BIN-A, its auto re-offer
// (round 2) fails on BIN-B too, and — critically — stock gets resynced
// (rids reassigned) between each round. This repo has no Supabase configured
// in tests, so placeHold() never actually persists a Hold for round 1's
// failure — round 3's only remaining defense against landing back on round
// 1's bin is the in-task exclusion built from task.facilities' own
// remembered lines. That exclusion was keyed on `rid`, which is stale for
// both round 1's and round 2's lines by the time round 3 is computed, so it
// silently matched nothing and round 3 could land right back on BIN-A.
describe("not-found re-offer avoids EVERY prior round's bin, not just the one that just failed", () => {
  it("stale rid exclusion: round 3 skips round 1's AND round 2's failed bins even though both rounds' remembered rids are stale relative to the current stock snapshot", async () => {
    // Round 1 is created against an earlier stock snapshot; its line
    // remembers rid 901 for BIN-A/BATCH-A.
    useStore.setState({
      stock: stock([901, 902, 903]),
      skus: { "SKU-NF": { name: "Product NF", shelf: 24 } },
      channelRules: { [CHANNEL]: { type: "fixed", val: 0 } },
      tasks: [taskWithRound1(901)],
    });

    // Stock resyncs before round 1 is worked — BIN-A/BATCH-A is now rid 501.
    useStore.setState({ stock: stock([501, 502, 503]) });
    await useStore.getState().applyPicks("TASK-NF-MH", { 901: 81 }, { 901: "Batch mismatch" }, "Tester");

    let updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round2 = updated.facilities.find((f) => f.round === 2)!;
    expect(round2.lines[0].bin).toBe("BIN-B");
    const round2Rid = round2.lines[0].rid; // whatever rid BIN-B/BATCH-B had at round-2 creation time (502)

    // Stock resyncs again before round 2 is worked — every lot gets a fresh
    // rid again, so round 2's remembered rid is now stale too.
    useStore.setState({ stock: stock([601, 602, 603]) });
    await useStore.getState().applyPicks(round2.no, { [round2Rid]: 81 }, { [round2Rid]: "Batch mismatch" }, "Tester");

    updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round3 = updated.facilities.find((f) => f.round === 3);
    expect(round3).toBeDefined();
    expect(round3!.lines[0].qty).toBe(81);
    // Must be the one lot neither round 1 nor round 2 already tried.
    expect(round3!.lines[0].bin).toBe("BIN-C");
    expect(round3!.lines[0].batch).toBe("BATCH-C");
  });

  it("does not cross-exclude a different facility's bin that happens to share the same bin+batch code", async () => {
    // Two facilities each have their own "BIN-A"/"BATCH-A" for this SKU —
    // bin/batch codes are only unique within a facility. Round 1 fails at SL
    // Mother Hub's BIN-A; the fix must not also exclude SL Ambient's
    // identically named BIN-A/BATCH-A, a completely different physical lot.
    const twoFacilityStock: StockRow[] = [
      { rid: 701, location: "SL Mother Hub", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 1], qty: 81, shelf: 24, type: "Good", active: "Active" },
      { rid: 702, location: "SL Ambient", bin: "BIN-A", sku: "SKU-NF", name: "Product NF", batch: "BATCH-A", exp: [2099, 2], qty: 81, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock: twoFacilityStock,
      skus: { "SKU-NF": { name: "Product NF", shelf: 24 } },
      channelRules: { [CHANNEL]: { type: "fixed", val: 0 } },
      tasks: [taskWithRound1(701)],
    });

    await useStore.getState().applyPicks("TASK-NF-MH", { 701: 81 }, { 701: "Batch mismatch" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-NF")!;
    const round2 = updated.facilities.find((f) => f.round === 2);
    expect(round2).toBeDefined();
    expect(round2!.lines[0].facility).toBe("SL Ambient");
    expect(round2!.lines[0].bin).toBe("BIN-A");
    expect(round2!.lines[0].batch).toBe("BATCH-A");
  });
});
