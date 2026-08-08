import { describe, expect, it } from "vitest";
import { notFoundSummary } from "../../src/lib/notFoundSummary";
import type { PickingTask } from "../../src/lib/types";

function line(overrides: Partial<PickingTask["facilities"][number]["lines"][number]> = {}) {
  return { rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [],
    ...overrides,
  };
}

describe("notFoundSummary", () => {
  it("ignores lines with no not-found quantity", () => {
    const t = task({ facilities: [{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0, lines: [line({ nf: 0, picked: 10 })] }] });
    expect(notFoundSummary([t])).toEqual([]);
  });

  it("aggregates total not-found quantity and reason breakdown per SKU", () => {
    const t = task({
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 7,
          lines: [
            line({ rid: 1, sku: "SKU-A", nf: 4, nfReason: "Damaged stock", picked: 6 }),
            line({ rid: 2, sku: "SKU-A", nf: 3, nfReason: "Batch not found", picked: 7 }),
          ],
        },
      ],
    });
    const [entry] = notFoundSummary([t]);
    expect(entry.sku).toBe("SKU-A");
    expect(entry.totalQty).toBe(7);
    expect(entry.byReason).toEqual({ "Damaged stock": 4, "Batch not found": 3 });
  });

  it("labels a missing reason as 'Not specified' instead of dropping it", () => {
    const t = task({ facilities: [{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 2, lines: [line({ nf: 2, nfReason: undefined, picked: 8 })] }] });
    const [entry] = notFoundSummary([t]);
    expect(entry.byReason).toEqual({ "Not specified": 2 });
  });

  it("tracks which shelf/bin the SKU couldn't be found at, so the shelf can be investigated", () => {
    const t = task({
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 6,
          lines: [
            line({ rid: 1, sku: "SKU-A", bin: "A1-05", nf: 4, picked: 6 }),
            line({ rid: 2, sku: "SKU-A", bin: "A1-05", nf: 0, picked: 10 }), // found here — shouldn't add a bin
            line({ rid: 3, sku: "SKU-A", bin: "B2-01", nf: 2, picked: 8 }),
          ],
        },
      ],
    });
    const [entry] = notFoundSummary([t]);
    expect(entry.bins).toEqual(["A1-05", "B2-01"]);
  });

  it("tracks which facilities and picklists a SKU went not-found in, without duplicates", () => {
    const t = task({
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 2, lines: [line({ rid: 1, sku: "SKU-A", nf: 2, picked: 8 })] },
        { no: "TASK-1-MH-R2", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 2, bad: 1, lines: [line({ rid: 2, sku: "SKU-A", nf: 1, picked: 1 })] },
      ],
    });
    const [entry] = notFoundSummary([t]);
    expect(entry.facilities).toEqual(["SL Mother Hub"]);
    expect(entry.picklists).toEqual(["TASK-1-MH", "TASK-1-MH-R2"]);
  });

  it("sorts by total not-found quantity, largest first", () => {
    const t = task({
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 3, lines: [line({ rid: 1, sku: "SKU-SMALL", nf: 1, picked: 9 }), line({ rid: 2, sku: "SKU-BIG", nf: 8, picked: 2 })] },
      ],
    });
    const summary = notFoundSummary([t]);
    expect(summary.map((e) => e.sku)).toEqual(["SKU-BIG", "SKU-SMALL"]);
  });
});
