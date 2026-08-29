import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local"; // has a built-in rule

// Real case: B2BE-BLINKIT-260829-011-MH (Gate Pass GPSLMH9749). Marking Not
// Found and clicking "Mark completed" did nothing — the picklist stayed
// open, nothing picked, no round 2. Same crash shape as the missing-
// channel-rule bug: state.skus[sku] was read unguarded when building the
// round-2 re-offer, so a not-found SKU absent from this browser's current
// stock/skus snapshot (stale local state after a resync, or genuinely zero
// stock everywhere right now) threw before applyPicks' own set() ever ran —
// losing the entire completion, not just the re-offer.
function taskWithSkuNotInLocalStock(): PickingTask {
  return {
    no: "TASK-MISSINGSKU",
    channel: CHANNEL,
    demand: [
      { channel: CHANNEL, sku: "SKU-KNOWN", qty: 10, gatePassNo: "GPSLMH-9749" },
      { channel: CHANNEL, sku: "SKU-GONE", qty: 5, gatePassNo: "GPSLMH-9749" },
    ],
    facilities: [
      {
        no: "TASK-MISSINGSKU-MH",
        taskNo: "TASK-MISSINGSKU",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-9749",
        lines: [
          { rid: 701, sku: "SKU-KNOWN", name: "Known product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 10 },
          // SKU-GONE is on the picklist (it existed when this was generated)
          // but has since dropped out of `skus` entirely — e.g. a resync
          // wiped it to zero everywhere.
          { rid: 702, sku: "SKU-GONE", name: "Discontinued product", facility: "SL Mother Hub", bin: "A2", batch: "B2", exp: [2099, 1], rem: 900, qty: 5 },
        ],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("applyPicks — completing a picklist with a not-found SKU missing from local stock/skus", () => {
  it("does not throw, still completes the facility, and skips re-offering only the missing SKU", async () => {
    const stock: StockRow[] = [
      { rid: 801, location: "SL Mother Hub", bin: "A3", sku: "SKU-KNOWN", name: "Known product", batch: "B3", exp: [2099, 2], qty: 5, shelf: 24, type: "Good", active: "Active" },
      // Deliberately no stock row for SKU-GONE — mirrors it being absent
      // from `skus` too, since skusFromStock derives skus from stock rows.
    ];
    useStore.setState({
      stock,
      skus: { "SKU-KNOWN": { name: "Known product", shelf: 24 } }, // SKU-GONE absent on purpose
      tasks: [taskWithSkuNotInLocalStock()],
    });
    expect(useStore.getState().skus["SKU-GONE"]).toBeUndefined();

    const noticesSeen: string[] = [];
    const unsub = useStore.subscribe((s) => { if (s.notice) noticesSeen.push(s.notice); });

    // Both lines fully not-found — this is exactly the path that used to crash.
    await expect(
      useStore.getState().applyPicks("TASK-MISSINGSKU-MH", { 701: 10, 702: 5 }, { 701: "Damaged stock", 702: "Damaged stock" }, "Tester"),
    ).resolves.not.toThrow();
    unsub();

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-MISSINGSKU");
    const facility = updated?.facilities.find((f) => f.no === "TASK-MISSINGSKU-MH");
    expect(facility?.status).toBe("completed");
    expect(facility?.pickedTotal).toBe(0);
    expect(facility?.bad).toBe(15);

    // SKU-KNOWN still gets its normal round-2 re-offer.
    const reoffer = updated?.facilities.find((f) => f.round === 2);
    expect(reoffer).toBeDefined();
    expect(reoffer!.lines.some((l) => l.sku === "SKU-KNOWN")).toBe(true);
    expect(reoffer!.lines.some((l) => l.sku === "SKU-GONE")).toBe(false);

    expect(noticesSeen.some((n) => /not in the current stock sync/.test(n) && /SKU-GONE/.test(n))).toBe(true);
  });
});
