import { afterEach, describe, expect, it } from "vitest";
import { gatePassPending, useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// Real case: B2BE-NYKAA-260827-003. SL Ambient's round 1 came up short; the
// re-offer landed at SL Mother Hub because that's where the leftover stock
// was — but SL Mother Hub ALSO already had its own unrelated, still-open
// round-1 order on this same task, and the re-offer wrongly inherited that
// order's gate pass (GPSLMH9639) even though it has nothing to do with the
// Ambient shortfall.
function taskWithUnrelatedOpenSiblingAtTheFulfillingFacility(): PickingTask {
  return {
    no: "TASK-XFAC",
    channel: CHANNEL,
    demand: [
      { channel: CHANNEL, sku: "SKU-MH-OWN", qty: 20, gatePassNo: "GPSLMH-OWN" },
      { channel: CHANNEL, sku: "SKU-SHORT", qty: 10, gatePassNo: "GPSLAMB-SHORT" },
    ],
    facilities: [
      // Mother Hub's own, unrelated, still-open round-1 order — must stay untouched.
      {
        no: "TASK-XFAC-MH",
        taskNo: "TASK-XFAC",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-OWN",
        lines: [{ rid: 501, sku: "SKU-MH-OWN", name: "MH-owned product", facility: "SL Mother Hub", bin: "M1", batch: "BM1", exp: [2099, 1], rem: 900, qty: 20 }],
      },
      // Ambient's round 1 — this is the one about to come up short.
      {
        no: "TASK-XFAC-AMB",
        taskNo: "TASK-XFAC",
        facility: "SL Ambient",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLAMB-SHORT",
        lines: [{ rid: 502, sku: "SKU-SHORT", name: "Short product", facility: "SL Ambient", bin: "A1", batch: "BA1", exp: [2099, 1], rem: 900, qty: 10 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("re-offer gate pass inheritance is scoped to the facility that actually came up short", () => {
  it("does NOT inherit an unrelated sibling order's gate pass when the re-offer is fulfilled at a different facility", async () => {
    const stock: StockRow[] = [
      // SKU-SHORT's only remaining stock is at SL Mother Hub — the facility
      // with its own, unrelated open order and gate pass.
      { rid: 601, location: "SL Mother Hub", bin: "M2", sku: "SKU-SHORT", name: "Short product", batch: "BM2", exp: [2099, 2], qty: 10, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-MH-OWN": { name: "MH-owned product", shelf: 24 }, "SKU-SHORT": { name: "Short product", shelf: 24 } },
      tasks: [taskWithUnrelatedOpenSiblingAtTheFulfillingFacility()],
    });

    // Ambient's round 1 comes up 10 short — the entire demand is not-found.
    await useStore.getState().applyPicks("TASK-XFAC-AMB", { 502: 10 }, { 502: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-XFAC");
    const reoffer = updated?.facilities.find((f) => f.round === 2);

    expect(reoffer).toBeDefined();
    expect(reoffer!.facility).toBe("SL Mother Hub"); // fulfilled at Mother Hub, not Ambient
    expect(reoffer!.gatePassNo).toBeUndefined(); // must NOT have inherited Mother Hub's own order's gate pass
    expect(gatePassPending(reoffer!, updated)).toBe(true); // needs its own, fresh gate pass

    // Mother Hub's own unrelated order is completely untouched.
    const mhOwn = updated?.facilities.find((f) => f.no === "TASK-XFAC-MH");
    expect(mhOwn!.gatePassNo).toBe("GPSLMH-OWN");
    expect(mhOwn!.status).toBe("open");
  });
});
