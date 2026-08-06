import { describe, expect, it } from "vitest";
import { overallReport } from "../../src/lib/overallReport";
import type { PickingTask } from "../../src/lib/types";

function line(overrides: Partial<PickingTask["facilities"][number]["lines"][number]> = {}) {
  return { rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    gatePassNo: "GP-1001",
    channel: "Blinkit",
    demand: [{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" }],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [],
    ...overrides,
  };
}

describe("overallReport", () => {
  it("sums demand, shortfall, picklist, not-found, and picked quantity per channel", () => {
    const t = task({
      channel: "Blinkit",
      demand: [{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" }],
      shortfall: [{ sku: "SKU-1", name: "Product 1", qty: 3 }],
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 2,
          lines: [line({ qty: 17, picked: 15, nf: 2 })],
        },
      ],
    });
    const [row] = overallReport([t]);
    expect(row.channel).toBe("Blinkit");
    expect(row.demandQty).toBe(20);
    expect(row.shortfallQty).toBe(3);
    expect(row.picklistQty).toBe(17);
    expect(row.notFoundQty).toBe(2);
    expect(row.pickedQty).toBe(15);
  });

  it("rolls up multiple gate passes for the same channel into one row", () => {
    const t1 = task({
      no: "TASK-1", gatePassNo: "GP-1001", channel: "Amazon",
      demand: [{ channel: "Amazon", sku: "SKU-1", qty: 10, gatePassNo: "GP-1001" }],
      facilities: [{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line({ qty: 10 })] }],
    });
    const t2 = task({
      no: "TASK-2", gatePassNo: "GP-1002", channel: "Amazon",
      demand: [{ channel: "Amazon", sku: "SKU-1", qty: 5, gatePassNo: "GP-1002" }],
      facilities: [{ no: "TASK-2-MH", taskNo: "TASK-2", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line({ qty: 5 })] }],
    });
    const report = overallReport([t1, t2]);
    expect(report).toHaveLength(1);
    expect(report[0].demandQty).toBe(15);
    expect(report[0].picklistQty).toBe(15);
  });

  it("keeps channels with no picking activity yet at zero, not undefined", () => {
    const t = task({ channel: "Nykaa", demand: [{ channel: "Nykaa", sku: "SKU-1", qty: 8, gatePassNo: "GP-1001" }], facilities: [] });
    const [row] = overallReport([t]);
    expect(row.picklistQty).toBe(0);
    expect(row.notFoundQty).toBe(0);
    expect(row.pickedQty).toBe(0);
  });
});
