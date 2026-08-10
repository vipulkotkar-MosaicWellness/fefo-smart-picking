import { describe, expect, it } from "vitest";
import { holdKey } from "../../src/lib/holds";
import { activeTasks, reservedFor } from "../../src/lib/store";
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
});
