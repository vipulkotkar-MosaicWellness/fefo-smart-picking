import { describe, expect, it } from "vitest";
import { pickerWorkload, queueBucket, queueMetrics } from "../../src/lib/supervisorMetrics";
import type { FacilityPicklist } from "../../src/lib/types";

function line(overrides: Partial<FacilityPicklist["lines"][number]> = {}) {
  return { rid: 1, sku: "S1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function facility(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "PK-1",
    taskNo: "T-1",
    facility: "SL Mother Hub",
    status: "open",
    round: 1,
    bad: 0,
    lines: [line()],
    ...overrides,
  };
}

describe("queueMetrics", () => {
  it("counts open picklists as anything not completed", () => {
    const m = queueMetrics([facility({ status: "open" }), facility({ status: "completed" })]);
    expect(m.openCount).toBe(1);
  });

  it("counts unassigned as open picklists with no picker on any line", () => {
    const unassigned = facility({ status: "open", lines: [line({ picker: undefined })] });
    const assigned = facility({ status: "open", no: "PK-2", lines: [line({ picker: "Ravi" })] });
    const m = queueMetrics([unassigned, assigned]);
    expect(m.unassignedCount).toBe(1);
  });

  it("computes fill rate only from completed picklists, ignoring untouched open ones", () => {
    const completed = facility({
      status: "completed",
      lines: [line({ qty: 10, picked: 8, nf: 2 })],
    });
    const stillOpen = facility({ status: "open", no: "PK-3", lines: [line({ qty: 100, picked: undefined })] });
    const m = queueMetrics([completed, stillOpen]);
    expect(m.fillRatePct).toBe(80);
  });

  it("returns null fill rate when nothing has completed yet, instead of a misleading 0%", () => {
    const m = queueMetrics([facility({ status: "open" })]);
    expect(m.fillRatePct).toBeNull();
  });
});

describe("queueBucket", () => {
  it("puts an unassigned open picklist in creation", () => {
    expect(queueBucket(facility({ status: "open", lines: [line({ picker: undefined })] }))).toBe("creation");
  });

  it("puts an assigned open picklist in picking", () => {
    expect(queueBucket(facility({ status: "open", lines: [line({ picker: "Ravi" })] }))).toBe("picking");
  });

  it("puts a WMS-blocked open picklist in blocked, even though a picker is still assigned", () => {
    expect(queueBucket(facility({ status: "open", lines: [line({ picker: "Ravi" })], wmsBlocked: true }))).toBe("blocked");
  });

  it("puts a fully completed picklist (no shortfall) in done", () => {
    expect(queueBucket(facility({ status: "completed", bad: 0 }))).toBe("done");
  });

  it("puts a completed picklist with a not-found shortfall in exception, not done", () => {
    expect(queueBucket(facility({ status: "completed", bad: 3 }))).toBe("exception");
  });
});

describe("pickerWorkload", () => {
  it("counts each picker's active (not-yet-picked) lines across open picklists", () => {
    const f = facility({
      status: "open",
      lines: [line({ rid: 1, picker: "Ravi" }), line({ rid: 2, picker: "Ravi" }), line({ rid: 3, picker: "Sunil", picked: 5 })],
    });
    const workload = pickerWorkload([f], ["Ravi", "Sunil", "Amit"]);
    expect(workload.find((w) => w.picker === "Ravi")?.activeLines).toBe(2);
    expect(workload.find((w) => w.picker === "Sunil")?.activeLines).toBe(0); // already picked
    expect(workload.find((w) => w.picker === "Amit")?.activeLines).toBe(0);
  });
});
