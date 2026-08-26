import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

// A channel deliberately absent from channelRules — channelRules lives in
// each browser's own localStorage (see store.ts partialize), so a channel
// added on one device but not yet reopened on another reproduces this state
// exactly. Real case: "LJ Kolkata" crashed applyPicks on completion because
// cutoffMonths(undefined, ...) threw, losing the entire completion.
const CHANNEL_WITH_NO_RULE = "LJ Kolkata";

function task(): PickingTask {
  return {
    no: "TASK-NOCHRULE",
    channel: CHANNEL_WITH_NO_RULE,
    demand: [{ channel: CHANNEL_WITH_NO_RULE, sku: "SKU-NCR", qty: 15, gatePassNo: "GPSLMH-9534" }],
    facilities: [
      {
        no: "TASK-NOCHRULE-MH",
        taskNo: "TASK-NOCHRULE",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9534",
        lines: [{ rid: 301, sku: "SKU-NCR", name: "Product NCR", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("applyPicks — completing a picklist whose channel has no rule on this device", () => {
  it("does not throw, and still completes the facility (no round-2 re-offer, missing-rule notice instead)", async () => {
    const stock: StockRow[] = [
      { rid: 301, location: "SL Mother Hub", bin: "A1", sku: "SKU-NCR", name: "Product NCR", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-NCR": { name: "Product NCR", shelf: 24 } }, tasks: [task()] });
    expect(useStore.getState().channelRules[CHANNEL_WITH_NO_RULE]).toBeUndefined();

    // A trailing fire-and-forget loadFromSupabase() inside applyPicks can
    // overwrite `notice` again once the feed unfreezes, so capture every
    // notice seen rather than trusting whatever's left after everything settles.
    const noticesSeen: string[] = [];
    const unsub = useStore.subscribe((s) => { if (s.notice) noticesSeen.push(s.notice); });

    // Reports 5 not-found (of 15) — this is exactly the path that used to crash.
    await expect(
      useStore.getState().applyPicks("TASK-NOCHRULE-MH", { 301: 5 }, { 301: "Damaged stock" }, "Tester"),
    ).resolves.not.toThrow();
    unsub();

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-NOCHRULE");
    const facility = updated?.facilities.find((f) => f.no === "TASK-NOCHRULE-MH");
    expect(facility?.status).toBe("completed");
    expect(facility?.pickedTotal).toBe(10);
    expect(facility?.bad).toBe(5);
    // No round-2 facility — the re-offer was skipped, not attempted with bad data.
    expect(updated?.facilities.some((f) => f.round === 2)).toBe(false);
    expect(noticesSeen.some((n) => /no channel rule on this device/.test(n))).toBe(true);
  });

  it("still runs the normal round-2 re-offer when the channel does have a rule", async () => {
    const stock: StockRow[] = [
      { rid: 401, location: "SL Mother Hub", bin: "A1", sku: "SKU-HR", name: "Product HR", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      { rid: 402, location: "SL Mother Hub", bin: "A2", sku: "SKU-HR", name: "Product HR", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];
    const t: PickingTask = {
      no: "TASK-HASRULE",
      channel: "Internal Stock Transfer - Warehouse - Local",
      demand: [{ channel: "Internal Stock Transfer - Warehouse - Local", sku: "SKU-HR", qty: 15, gatePassNo: "GPSLMH-9535" }],
      facilities: [
        {
          no: "TASK-HASRULE-MH",
          taskNo: "TASK-HASRULE",
          facility: "SL Mother Hub",
          status: "open",
          round: 1,
          bad: 0,
          gatePassNo: "GPSLMH-9535",
          lines: [{ rid: 401, sku: "SKU-HR", name: "Product HR", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };
    useStore.setState({ stock, skus: { "SKU-HR": { name: "Product HR", shelf: 24 } }, tasks: [t] });
    expect(useStore.getState().channelRules["Internal Stock Transfer - Warehouse - Local"]).toBeDefined();

    await useStore.getState().applyPicks("TASK-HASRULE-MH", { 401: 10 }, { 401: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t2) => t2.no === "TASK-HASRULE");
    expect(updated?.facilities.some((f) => f.round === 2)).toBe(true);
    expect(useStore.getState().notice).not.toMatch(/no channel rule on this device/);
  });
});
