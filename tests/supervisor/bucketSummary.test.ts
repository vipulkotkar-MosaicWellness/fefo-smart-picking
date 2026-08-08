import { describe, expect, it } from "vitest";
import { bucketSummary } from "../../src/lib/supervisorMetrics";
import type { FacilityPicklist } from "../../src/lib/types";

function line(overrides: Partial<FacilityPicklist["lines"][number]> = {}) {
  return { rid: 1, sku: "S1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function facility(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return { no: "PK-1", taskNo: "T-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line()], ...overrides };
}

describe("bucketSummary", () => {
  it("returns zeros for an empty bucket", () => {
    expect(bucketSummary([])).toEqual({ picklistCount: 0, lineCount: 0, unitCount: 0, pickedUnits: 0, pendingUnits: 0 });
  });

  it("sums picklists, lines, and units, splitting picked vs pending", () => {
    // Line 1 is already resolved (qty 10, picked 6 — the other 4 are a
    // recorded not-found, not "still pending"). Line 2 hasn't been touched
    // yet at all, so its full qty counts as pending. Line 3 is fully picked.
    const items = [
      facility({ no: "PK-1", lines: [line({ rid: 1, qty: 10, picked: 6 }), line({ rid: 2, qty: 5, picked: undefined })] }),
      facility({ no: "PK-2", lines: [line({ rid: 3, qty: 8, picked: 8 })] }),
    ];
    const s = bucketSummary(items);
    expect(s.picklistCount).toBe(2);
    expect(s.lineCount).toBe(3);
    expect(s.unitCount).toBe(23);
    expect(s.pickedUnits).toBe(14);
    expect(s.pendingUnits).toBe(5);
  });
});
