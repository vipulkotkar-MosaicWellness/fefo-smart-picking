import { describe, expect, it } from "vitest";
import { holdKey } from "../../src/lib/holds";
import { activeFacilityLists, activeTasks, dueForWmsBlock, reservedFor, stampAssignment, WMS_BLOCK_DELAY_MS } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    gatePassNo: "GP-1001",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [],
    ...overrides,
  };
}

describe("activeTasks", () => {
  it("excludes archived tasks", () => {
    const tasks = [task({ no: "A" }), task({ no: "B", archived: true }), task({ no: "C" })];
    expect(activeTasks(tasks).map((t) => t.no)).toEqual(["A", "C"]);
  });

  it("keeps everything when nothing is archived", () => {
    const tasks = [task({ no: "A" }), task({ no: "B" })];
    expect(activeTasks(tasks)).toHaveLength(2);
  });
});

describe("reservedFor — archived tasks never hold a reservation", () => {
  const KEY = holdKey("SKU-1", "SL Mother Hub", "A1", "B1");

  it("ignores a still-open line's reservation once its task is archived", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const openInArchivedTask = task({
      no: "TASK-ARCHIVED",
      archived: true,
      facilities: [{ no: "TASK-ARCHIVED-MH", taskNo: "TASK-ARCHIVED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line] }],
    });
    expect(reservedFor([openInArchivedTask], KEY)).toBe(0);
  });

  it("still reserves for the same line when its task is active", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const active = task({
      no: "TASK-ACTIVE",
      facilities: [{ no: "TASK-ACTIVE-MH", taskNo: "TASK-ACTIVE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line] }],
    });
    expect(reservedFor([active], KEY)).toBe(20);
  });

  it("matches by sku+facility+bin+batch identity, NOT by rid — a stock resync can freely reassign rid without breaking reservations", () => {
    // The open line was created when this physical lot's row happened to get rid 1.
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const active = task({
      no: "TASK-ACTIVE",
      facilities: [{ no: "TASK-ACTIVE-MH", taskNo: "TASK-ACTIVE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line] }],
    });
    // After a resync, an UNRELATED lot (different sku+bin+batch) coincidentally
    // lands on the same rid=1. Reservation lookups for that unrelated lot must
    // return 0 — the old line's rid is now stale and must not be trusted.
    const unrelatedLotKey = holdKey("SKU-2", "SL Mother Hub", "A1", "B2");
    expect(reservedFor([active], unrelatedLotKey)).toBe(0);
    // The original lot's real identity still correctly shows 20 reserved.
    expect(reservedFor([active], KEY)).toBe(20);
  });

  it("does not reserve a discarded facility picklist's stock, even though its parent task is still active", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const withDiscardedFacility = task({
      no: "TASK-MIXED",
      facilities: [{ no: "TASK-MIXED-MH", taskNo: "TASK-MIXED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line], discarded: true }],
    });
    expect(reservedFor([withDiscardedFacility], KEY)).toBe(0);
  });

  it("still reserves a WMS-blocked facility's unpicked stock — the block only affects the sync freeze, not FEFO reservation", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const withWmsBlock = task({
      no: "TASK-BLOCKED",
      facilities: [{ no: "TASK-BLOCKED-MH", taskNo: "TASK-BLOCKED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line], wmsBlocked: true }],
    });
    expect(reservedFor([withWmsBlock], KEY)).toBe(20);
  });
});

describe("stampAssignment", () => {
  const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
  function facility(overrides: Partial<PickingTask["facilities"][number]> = {}) {
    return { no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open" as const, round: 1, bad: 0, lines: [line], ...overrides };
  }

  it("stamps assignedAt on the first assignment", () => {
    const f = stampAssignment(facility());
    expect(f.assignedAt).toBeDefined();
  });

  it("does not move the clock on a later, incremental assignment", () => {
    const firstAssignedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const f = stampAssignment(facility({ assignedAt: firstAssignedAt }));
    expect(f.assignedAt).toBe(firstAssignedAt);
  });

  it("does not clear an existing WMS block on a later, incremental assignment", () => {
    const assignedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const wmsBlockedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const f = stampAssignment(facility({ assignedAt, wmsBlocked: true, wmsBlockedAt }));
    expect(f.wmsBlocked).toBe(true);
    expect(f.wmsBlockedAt).toBe(wmsBlockedAt);
  });

  it("restarts the clock and clears the revoke once the picklist is reassigned after a revoke", () => {
    const staleAssignedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const f = stampAssignment(
      facility({ assignedAt: staleAssignedAt, wmsRevokedAt: new Date().toISOString(), wmsRevokedBy: "Admin" }),
    );
    expect(f.assignedAt).not.toBe(staleAssignedAt);
    expect(f.wmsRevokedAt).toBeUndefined();
    expect(f.wmsRevokedBy).toBeUndefined();
    expect(f.wmsBlocked).toBe(false);
  });
});

describe("dueForWmsBlock", () => {
  const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };

  it("flags an assigned, unblocked facility once 15 minutes have passed", () => {
    const assignedAt = new Date(Date.now() - WMS_BLOCK_DELAY_MS - 1000).toISOString();
    const t = task({
      facilities: [{ no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line], assignedAt }],
    });
    expect(dueForWmsBlock([t]).map((f) => f.no)).toEqual(["F-1"]);
  });

  it("does not flag a facility assigned less than 15 minutes ago", () => {
    const assignedAt = new Date(Date.now() - 60_000).toISOString();
    const t = task({
      facilities: [{ no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line], assignedAt }],
    });
    expect(dueForWmsBlock([t])).toEqual([]);
  });

  it("does not re-flag a facility already blocked", () => {
    const assignedAt = new Date(Date.now() - WMS_BLOCK_DELAY_MS - 1000).toISOString();
    const t = task({
      facilities: [{ no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line], assignedAt, wmsBlocked: true }],
    });
    expect(dueForWmsBlock([t])).toEqual([]);
  });

  it("does not flag a facility whose block was revoked, even past 15 minutes", () => {
    const assignedAt = new Date(Date.now() - WMS_BLOCK_DELAY_MS - 1000).toISOString();
    const t = task({
      facilities: [{
        no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line],
        assignedAt, wmsRevokedAt: new Date().toISOString(), wmsRevokedBy: "Admin",
      }],
    });
    expect(dueForWmsBlock([t])).toEqual([]);
  });

  it("does not flag a completed facility", () => {
    const assignedAt = new Date(Date.now() - WMS_BLOCK_DELAY_MS - 1000).toISOString();
    const t = task({
      facilities: [{ no: "F-1", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0, lines: [line], assignedAt }],
    });
    expect(dueForWmsBlock([t])).toEqual([]);
  });
});

describe("activeFacilityLists — discarding is a separate concept from archiving", () => {
  it("excludes a discarded facility picklist even when its parent task is active", () => {
    const task1 = task({
      no: "TASK-1",
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [], discarded: true },
        { no: "TASK-1-AMB", taskNo: "TASK-1", facility: "SL Ambient", status: "open", round: 1, bad: 0, lines: [] },
      ],
    });
    expect(activeFacilityLists([task1]).map((f) => f.no)).toEqual(["TASK-1-AMB"]);
  });

  it("excludes every facility of an archived task, discarded or not", () => {
    const task1 = task({
      no: "TASK-ARCHIVED",
      archived: true,
      facilities: [{ no: "TASK-ARCHIVED-MH", taskNo: "TASK-ARCHIVED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] }],
    });
    expect(activeFacilityLists([task1])).toEqual([]);
  });

  it("keeps a facility picklist that's neither archived nor discarded", () => {
    const task1 = task({
      no: "TASK-1",
      facilities: [{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [] }],
    });
    expect(activeFacilityLists([task1]).map((f) => f.no)).toEqual(["TASK-1-MH"]);
  });
});
