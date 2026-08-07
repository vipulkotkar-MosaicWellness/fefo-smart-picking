import { describe, expect, it } from "vitest";
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
  it("ignores a still-open line's reservation once its task is archived", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const openInArchivedTask = task({
      no: "TASK-ARCHIVED",
      archived: true,
      facilities: [{ no: "TASK-ARCHIVED-MH", taskNo: "TASK-ARCHIVED", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line] }],
    });
    expect(reservedFor([openInArchivedTask], 1)).toBe(0);
  });

  it("still reserves for the same line when its task is active", () => {
    const line = { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 20 };
    const active = task({
      no: "TASK-ACTIVE",
      facilities: [{ no: "TASK-ACTIVE-MH", taskNo: "TASK-ACTIVE", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line] }],
    });
    expect(reservedFor([active], 1)).toBe(20);
  });
});
