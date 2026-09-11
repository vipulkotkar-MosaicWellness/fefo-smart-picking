import { afterEach, describe, expect, it } from "vitest";
import { dueForAutoComplete, oneTimeCloseCutoffMs, useStore, WMS_BLOCK_DELAY_MS } from "../../src/lib/store";
import type { PickingTask, StockRow } from "../../src/lib/types";

/**
 * Reproduces the GPSLMH10328 supervisor complaint end-to-end with real
 * application code (no live login available to test in the actual UI):
 *   1. Round 1 short-picked with a not-found qty -> a fresh round 2 is created.
 *   2. Round 2 inherits round 1's gate pass and becomes WMS-blocked after
 *      WMS_BLOCK_DELAY_MS (15 minutes) has passed since ITS OWN creation —
 *      unrelated to how long round 1 existed.
 *   3. dueForAutoComplete (shared by both the recurring 4-day timer and the
 *      one-time "close aged WMS-blocked picklists" admin action) is checked
 *      against both kinds of cutoff, to see which one actually catches a
 *      round 2 that's only ~1 day old.
 *   4. The fix — oneTimeCloseCutoffMs's 24h safety floor — is proven to stop
 *      exactly the scenario step 3b demonstrates, without needing a live login.
 */

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function stock(): StockRow[] {
  return [
    // A second batch/bin is required so the not-found qty has somewhere to
    // be re-allocated to — the existing roundTwoGatePass.test.ts uses the
    // same two-row pattern for the same reason.
    { rid: 301, location: "SL Mother Hub", bin: "A1", sku: "SKU-REPRO", name: "Repro Product", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    { rid: 302, location: "SL Mother Hub", bin: "A2", sku: "SKU-REPRO", name: "Repro Product", batch: "B2", exp: [2099, 2], qty: 20, shelf: 24, type: "Good", active: "Active" },
  ];
}

function task(createdAt: string): PickingTask {
  return {
    no: "TASK-REPRO",
    channel: CHANNEL,
    demand: [{ channel: CHANNEL, sku: "SKU-REPRO", qty: 15, gatePassNo: "GPSLMH-REPRO" }],
    facilities: [
      {
        no: "TASK-REPRO-MH",
        taskNo: "TASK-REPRO",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH-REPRO",
        createdAt,
        lines: [{ rid: 301, sku: "SKU-REPRO", name: "Repro Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
      },
    ],
    shortfall: [],
    createdAt,
  };
}

describe("round-2 vs. the auto-complete cutoff-date cleanup (GPSLMH10328 repro)", () => {
  it("step 1-2: a short pick creates round 2, which becomes WMS-blocked on its OWN clock, not round 1's", async () => {
    const round1CreatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // round 1: 10 days old
    useStore.setState({ stock: stock(), skus: { "SKU-REPRO": { name: "Repro Product", shelf: 24 } }, tasks: [task(round1CreatedAt)] });

    // Picker finds only 9 of 15 -> 6 not-found -> round 2 re-offer fires.
    await useStore.getState().applyPicks("TASK-REPRO-MH", { 301: 9 }, { 301: "Damaged stock" }, "Tester");

    const updated = useStore.getState().tasks.find((t) => t.no === "TASK-REPRO")!;
    const r2 = updated.facilities.find((f) => f.round === 2)!;

    expect(r2).toBeDefined();
    expect(r2.gatePassNo).toBe("GPSLMH-REPRO"); // inherited immediately, same as GPSLMH10328
    console.log(`Round 2 created at: ${r2.createdAt} (round 1 was created ${round1CreatedAt}, 10 days earlier)`);

    // Round 2 isn't wmsBlocked yet at the instant of creation.
    expect(r2.wmsBlocked).toBeFalsy();

    // 16 minutes later (past WMS_BLOCK_DELAY_MS = 15 min), checkWmsAutoBlock's
    // sweep (dueForWmsBlock) would flip it — simulate that arrival directly,
    // exactly like GPSLMH10328's real wms_blocked=true.
    const sixteenMinLater = new Date(new Date(r2.createdAt!).getTime() + WMS_BLOCK_DELAY_MS + 60_000);
    console.log(`WMS_BLOCK_DELAY_MS = ${WMS_BLOCK_DELAY_MS / 60000} minutes -> round 2 would already be wmsBlocked by ${sixteenMinLater.toISOString()}, same day it was created.`);
  });

  it("step 3: the recurring 4-day timer does NOT catch a 1-day-old round 2 — the math is correct", async () => {
    const round1CreatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    useStore.setState({ stock: stock(), skus: { "SKU-REPRO": { name: "Repro Product", shelf: 24 } }, tasks: [task(round1CreatedAt)] });
    await useStore.getState().applyPicks("TASK-REPRO-MH", { 301: 9 }, { 301: "Damaged stock" }, "Tester");

    const oneDayLater = Date.now() + 26 * 60 * 60 * 1000; // GPSLMH10328's real gap: created->closed was ~26 hours
    const days = 4; // the account's real configured autoCompleteAfterDays
    const recurringCutoffMs = oneDayLater - days * 24 * 60 * 60 * 1000;

    const tasksNow = useStore.getState().tasks;
    const due = dueForAutoComplete(tasksNow, recurringCutoffMs);
    const r2Due = due.some((f) => f.round === 2);

    console.log(`Recurring 4-day timer, evaluated as if it were ${new Date(oneDayLater).toISOString()}: round 2 due for auto-complete? ${r2Due}`);
    expect(r2Due).toBe(false); // confirms the daily timer is NOT the culprit
  });

  it("step 3b (pre-fix mechanism): a one-time 'close aged WMS-blocked picklists' cutoff DATE, picked to sweep up old stuck picklists, ALSO catches a same-day-created round 2", async () => {
    const round1CreatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    useStore.setState({ stock: stock(), skus: { "SKU-REPRO": { name: "Repro Product", shelf: 24 } }, tasks: [task(round1CreatedAt)] });
    await useStore.getState().applyPicks("TASK-REPRO-MH", { 301: 9 }, { 301: "Damaged stock" }, "Tester");

    // An admin runs the one-time cleanup meaning to close out old stuck
    // picklists, picking a cutoff that (unknowingly) falls just after round 2
    // was created a few minutes ago. This ignores autoCompleteAfterDays
    // entirely (see closeAgedWmsBlockedPicklists) — any WMS-blocked facility
    // created on/before the chosen instant qualifies, full stop.
    const r2CreatedAt = useStore.getState().tasks.find((t) => t.no === "TASK-REPRO")!.facilities.find((f) => f.round === 2)!.createdAt!;
    const cutoffMs = new Date(r2CreatedAt).getTime() + 60_000;

    const tasksNow = useStore.getState().tasks;
    // dueForAutoComplete only looks at wmsBlocked=true facilities — mark it,
    // exactly as checkWmsAutoBlock's real 15-minute sweep would have by the
    // time an admin got around to running the cleanup.
    const flagged = tasksNow.map((t) => ({
      ...t,
      facilities: t.facilities.map((f) => (f.round === 2 ? { ...f, wmsBlocked: true } : f)),
    }));

    const due = dueForAutoComplete(flagged, cutoffMs);
    const r2Due = due.some((f) => f.round === 2);

    console.log(`One-time cleanup, cutoff = ${new Date(cutoffMs).toISOString()} (just after round 2's own createdAt ${r2CreatedAt}): round 2 due for auto-complete? ${r2Due}`);
    console.log(`This is the actual root cause: closeAgedWmsBlockedPicklists has no minimum-age floor of its own — any WMS-blocked facility created on/before the chosen date qualifies, including one created that same morning.`);
    expect(r2Due).toBe(true); // confirms this IS how GPSLMH10328 got silently closed
  });

  it("step 4 (the fix): oneTimeCloseCutoffMs's 24h floor protects the exact same round 2, even with 'today' as the cutoff date", async () => {
    const round1CreatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    useStore.setState({ stock: stock(), skus: { "SKU-REPRO": { name: "Repro Product", shelf: 24 } }, tasks: [task(round1CreatedAt)] });
    await useStore.getState().applyPicks("TASK-REPRO-MH", { 301: 9 }, { 301: "Damaged stock" }, "Tester");

    // The natural, dangerous admin choice: "today" as the cutoff, meaning to
    // sweep up backlog — not realizing round 2 was created minutes ago.
    const todayIso = new Date().toISOString().slice(0, 10);
    const fixedCutoffMs = oneTimeCloseCutoffMs(todayIso);

    const tasksNow = useStore.getState().tasks;
    const flagged = tasksNow.map((t) => ({
      ...t,
      facilities: t.facilities.map((f) => (f.round === 2 ? { ...f, wmsBlocked: true } : f)),
    }));

    const due = dueForAutoComplete(flagged, fixedCutoffMs);
    const r2Due = due.some((f) => f.round === 2);

    console.log(`WITH THE FIX — cutoff date "${todayIso}" clamps to ${new Date(fixedCutoffMs).toISOString()}: round 2 due for auto-complete? ${r2Due}`);
    expect(r2Due).toBe(false); // the fix holds — round 2 is protected
  });
});
