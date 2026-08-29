import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

// Real case: REPL-INTERNALSTOC-260828-008. SL Mother Hub's round 1 came up
// short, producing an open MH round-2 re-offer. Later, SL Ambient's own
// (unrelated) round 1 ALSO came up short, and its re-offer's leftover stock
// happened to sit at SL Mother Hub too — the fulfilling facility, not the
// one that ran short. The old code computed the new round purely from the
// facility that just completed (Ambient, round 1 -> round 2), and stamped
// that same round 2 onto whichever facility the reallocation landed on —
// including Mother Hub, which already HAD an open round 2. Two facility
// objects ended up sharing the exact same `no`, and every no-keyed lookup
// (discard, set gate pass, revoke WMS block, applyPicks itself) silently
// operated on only the first of the two, leaving the second unreachable —
// which is what actually blocked "discard" on the real gate pass.
function taskWithExistingRoundTwoAtTheFulfillingFacility(): PickingTask {
  return {
    no: "TASK-COLLIDE",
    channel: CHANNEL,
    demand: [
      { channel: CHANNEL, sku: "SKU-MH-R2", qty: 10, gatePassNo: "GPSLMH-R2" },
      { channel: CHANNEL, sku: "SKU-AMB-SHORT", qty: 5, gatePassNo: "GPSLAMB-SHORT" },
    ],
    facilities: [
      // Mother Hub round 1 — already completed earlier.
      {
        no: "TASK-COLLIDE-MH",
        taskNo: "TASK-COLLIDE",
        facility: "SL Mother Hub",
        status: "completed",
        round: 1,
        bad: 10,
        gatePassNo: "GPSLMH-R2",
        pickedTotal: 0,
        lines: [{ rid: 701, sku: "SKU-MH-R2", name: "MH re-offer product", facility: "SL Mother Hub", bin: "M1", batch: "BM1", exp: [2099, 1], rem: 900, qty: 10, picked: 0, nf: 10 }],
      },
      // Mother Hub round 2 — the re-offer from that shortfall, still open and
      // still gate-pass-pending. Must survive this test completely untouched.
      {
        no: "TASK-COLLIDE-MH-R2",
        taskNo: "TASK-COLLIDE",
        facility: "SL Mother Hub",
        status: "open",
        round: 2,
        bad: 0,
        lines: [{ rid: 702, sku: "SKU-MH-R2", name: "MH re-offer product", facility: "SL Mother Hub", bin: "M2", batch: "BM2", exp: [2099, 2], rem: 900, qty: 10 }],
      },
      // Ambient round 1 — about to come up short, unrelated to the above.
      {
        no: "TASK-COLLIDE-AMB",
        taskNo: "TASK-COLLIDE",
        facility: "SL Ambient",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLAMB-SHORT",
        lines: [{ rid: 703, sku: "SKU-AMB-SHORT", name: "Ambient short product", facility: "SL Ambient", bin: "A1", batch: "BA1", exp: [2099, 1], rem: 900, qty: 5 }],
      },
    ],
    shortfall: [],
    createdAt: new Date().toISOString(),
  };
}

describe("a re-offer landing on a facility that already has a higher round never collides `no`", () => {
  it("bumps to round 3 for Mother Hub instead of duplicating the existing round-2 entry's `no`", async () => {
    const stock: StockRow[] = [
      // The only remaining stock for Ambient's shortfall SKU is at Mother
      // Hub — the facility that already has its own open round 2.
      { rid: 801, location: "SL Mother Hub", bin: "M3", sku: "SKU-AMB-SHORT", name: "Ambient short product", batch: "BM3", exp: [2099, 3], qty: 5, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-MH-R2": { name: "MH re-offer product", shelf: 24 }, "SKU-AMB-SHORT": { name: "Ambient short product", shelf: 24 } },
      tasks: [taskWithExistingRoundTwoAtTheFulfillingFacility()],
    });

    // Ambient's round 1 comes up entirely short — reallocates to Mother Hub.
    await useStore.getState().applyPicks("TASK-COLLIDE-AMB", { 703: 5 }, { 703: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-COLLIDE")!;

    // No two facility entries ever share a `no`.
    const nos = updated.facilities.map((f) => f.no);
    expect(new Set(nos).size).toBe(nos.length);

    // The pre-existing Mother Hub round 2 is completely untouched.
    const existingMhR2 = updated.facilities.find((f) => f.no === "TASK-COLLIDE-MH-R2");
    expect(existingMhR2).toBeDefined();
    expect(existingMhR2!.lines).toHaveLength(1);
    expect(existingMhR2!.lines[0].rid).toBe(702);

    // The new re-offer landed as a genuinely new, higher-round entry.
    const newReoffer = updated.facilities.find((f) => f.facility === "SL Mother Hub" && f.no !== "TASK-COLLIDE-MH" && f.no !== "TASK-COLLIDE-MH-R2");
    expect(newReoffer).toBeDefined();
    expect(newReoffer!.round).toBe(3);
    expect(newReoffer!.no).toBe("TASK-COLLIDE-MH-R3");
  });
});
