import { describe, expect, it } from "vitest";
import { detailedReport } from "../../src/lib/detailedReport";
import type { PickingTask } from "../../src/lib/types";

function line(overrides: Partial<PickingTask["facilities"][number]["lines"][number]> = {}) {
  return { rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    channel: "Blinkit",
    // (channel is asserted directly in the tests below)
    demand: [],
    shortfall: [],
    createdAt: "2026-08-25T04:00:00.000Z",
    facilities: [],
    ...overrides,
  };
}

describe("detailedReport", () => {
  it("marks a completed line with no not-found qty as 'Picklist completed'", () => {
    const t = task({
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0,
          gatePassNo: "GPSLMH1001", createdAt: "2026-08-25T09:15:00.000Z",
          lines: [line({ qty: 10, picked: 10, nf: 0 })],
        },
      ],
    });
    const [row] = detailedReport([t]);
    expect(row.status).toBe("Picklist completed");
    expect(row.reportDate).toBe("2026-08-25");
    expect(row.channel).toBe("Blinkit");
    expect(row.taskNo).toBe("TASK-1");
    expect(row.gatePassNo).toBe("GPSLMH1001");
  });

  it("marks a completed line with not-found qty as 'Not found', even if partially picked", () => {
    const t = task({
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 2,
          gatePassNo: "GPSLMH1001",
          lines: [line({ qty: 10, picked: 8, nf: 2 })],
        },
      ],
    });
    const [row] = detailedReport([t]);
    expect(row.status).toBe("Not found");
  });

  it("marks every line 'Picking pending' while the facility picklist is still open, regardless of nf", () => {
    const t = task({
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line({ qty: 10 })] },
      ],
    });
    const [row] = detailedReport([t]);
    expect(row.status).toBe("Picking pending");
  });

  it("shows gate pass as undefined (rendered 'Pending' by the UI) when it hasn't been assigned yet", () => {
    const t = task({
      facilities: [{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line()] }],
    });
    const [row] = detailedReport([t]);
    expect(row.gatePassNo).toBeUndefined();
  });

  it("skips a discarded facility picklist entirely", () => {
    const t = task({
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, discarded: true, lines: [line()] },
      ],
    });
    expect(detailedReport([t])).toHaveLength(0);
  });

  it("emits one row per line, across multiple facilities and multiple lines", () => {
    const t = task({
      facilities: [
        {
          no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0,
          lines: [line({ rid: 1, sku: "SKU-1", qty: 10, picked: 10 }), line({ rid: 2, sku: "SKU-2", qty: 5, picked: 5 })],
        },
        {
          no: "TASK-1-AMB", taskNo: "TASK-1", facility: "SL Ambient", status: "open", round: 1, bad: 0,
          lines: [line({ rid: 3, sku: "SKU-3", facility: "SL Ambient", qty: 7 })],
        },
      ],
    });
    const rows = detailedReport([t]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sku).sort()).toEqual(["SKU-1", "SKU-2", "SKU-3"]);
  });

  it("falls back to the task's own createdAt when a facility round predates the per-round createdAt field", () => {
    const t = task({
      createdAt: "2026-08-20T06:00:00.000Z",
      facilities: [
        { no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line()] }, // no createdAt of its own
      ],
    });
    const [row] = detailedReport([t]);
    expect(row.reportDate).toBe("2026-08-20");
  });
});
