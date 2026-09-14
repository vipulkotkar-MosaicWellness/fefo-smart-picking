import { describe, expect, it } from "vitest";
import { needsAttentionList } from "../../src/lib/supervisorMetrics";
import type { FacilityPicklist } from "../../src/lib/types";

function fac(no: string, createdAt: string | undefined, opts: { picker?: string; status?: FacilityPicklist["status"] } = {}): FacilityPicklist {
  return {
    no,
    taskNo: "T1",
    facility: "SL Mother Hub",
    status: opts.status ?? "open",
    round: 1,
    bad: 0,
    createdAt,
    lines: [
      { rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5, picker: opts.picker },
    ],
  };
}

describe("needsAttentionList", () => {
  it("puts unassigned picklists ahead of assigned ones, regardless of age", () => {
    const olderAssigned = fac("F1", "2026-09-10T00:00:00Z", { picker: "Ravi" });
    const newerUnassigned = fac("F2", "2026-09-14T00:00:00Z");
    expect(needsAttentionList([olderAssigned, newerUnassigned], []).map((f) => f.no)).toEqual(["F2", "F1"]);
  });

  it("sorts oldest-first within the same assignment group", () => {
    const newer = fac("F1", "2026-09-14T00:00:00Z");
    const older = fac("F2", "2026-09-10T00:00:00Z");
    expect(needsAttentionList([newer, older], []).map((f) => f.no)).toEqual(["F2", "F1"]);
  });

  it("excludes completed picklists", () => {
    const done = fac("F1", "2026-09-10T00:00:00Z", { status: "completed" });
    const open = fac("F2", "2026-09-14T00:00:00Z");
    expect(needsAttentionList([done, open], []).map((f) => f.no)).toEqual(["F2"]);
  });

  it("falls back to the parent task's createdAt when the facility has none", () => {
    const f = fac("F1", undefined);
    const result = needsAttentionList([f], [{ no: "T1", createdAt: "2026-09-01T00:00:00Z" }]);
    expect(result).toHaveLength(1);
    expect(result[0].no).toBe("F1");
  });

  it("treats a picklist with any picker on any line as assigned, not unassigned", () => {
    const partiallyAssigned = fac("F1", "2026-09-10T00:00:00Z", { picker: "Ravi" });
    const fullyUnassigned = fac("F2", "2026-09-13T00:00:00Z");
    expect(needsAttentionList([partiallyAssigned, fullyUnassigned], []).map((f) => f.no)).toEqual(["F2", "F1"]);
  });
});
