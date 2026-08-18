import { describe, expect, it } from "vitest";
import { binSkipReport } from "../../src/lib/binSkipReport";
import type { PickingTask } from "../../src/lib/types";

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    gatePassNo: "GP-1001",
    channel: "Internal Stock Transfer - Warehouse - 3PL",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [],
    ...overrides,
  };
}

const skip1 = { sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "B1", qtyAvailable: 12, threshold: 20 };
const skip2 = { sku: "SKU-2", name: "Product 2", facility: "SL Mother Hub", bin: "A2", batch: "B2", qtyAvailable: 5, threshold: 20 };

describe("binSkipReport", () => {
  it("flattens each task's binSkips with its picklist context attached", () => {
    const t = task({ binSkips: [skip1] });
    const entries = binSkipReport([t]);
    expect(entries).toEqual([{ taskNo: "TASK-1", gatePassNo: "GP-1001", channel: "Internal Stock Transfer - Warehouse - 3PL", createdAt: t.createdAt, ...skip1 }]);
  });

  it("returns nothing for tasks with no binSkips", () => {
    expect(binSkipReport([task()])).toEqual([]);
  });

  it("flattens multiple skips across multiple tasks", () => {
    const t1 = task({ no: "TASK-1", binSkips: [skip1] });
    const t2 = task({ no: "TASK-2", binSkips: [skip2] });
    const entries = binSkipReport([t1, t2]);
    expect(entries.map((e) => e.taskNo).sort()).toEqual(["TASK-1", "TASK-2"]);
  });

  it("sorts newest first", () => {
    const older = task({ no: "OLD", createdAt: "2026-01-01T00:00:00Z", binSkips: [skip1] });
    const newer = task({ no: "NEW", createdAt: "2026-06-01T00:00:00Z", binSkips: [skip2] });
    const entries = binSkipReport([older, newer]);
    expect(entries.map((e) => e.taskNo)).toEqual(["NEW", "OLD"]);
  });
});
