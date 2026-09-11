import { describe, expect, it } from "vitest";
import { lineBreach, lineReason, lineTone, type AdherenceLine } from "../../src/lib/gatepassAdherenceSupabase";

function line(overrides: Partial<AdherenceLine>): AdherenceLine {
  return {
    sku: "S1",
    bin: "A",
    batch: "B1",
    instructed_qty: 100,
    actual_qty: 100,
    compliant_qty: 100,
    fefo_breach: "No",
    reason: "Bin & batch match",
    ...overrides,
  };
}

describe("gatepass adherence line helpers — new-shape rows", () => {
  it("clean pick: no breach, ok tone", () => {
    const l = line({ fefo_breach: "No", reason: "Bin & batch match" });
    expect(lineBreach(l)).toBe("No");
    expect(lineReason(l)).toBe("Bin & batch match");
    expect(lineTone(l)).toBe("ok");
  });

  it("right batch, wrong shelf: not a breach, warn tone", () => {
    const l = line({ fefo_breach: "No", reason: "Batch match, bin mismatch" });
    expect(lineBreach(l)).toBe("No");
    expect(lineTone(l)).toBe("warn");
  });

  it("partial pick of correct batch: not a breach, warn tone", () => {
    const l = line({ fefo_breach: "No", reason: "Partial pick — correct batch", compliant_qty: 80 });
    expect(lineBreach(l)).toBe("No");
    expect(lineTone(l)).toBe("warn");
  });

  it("wrong batch: breach, bad tone", () => {
    const l = line({ fefo_breach: "Yes", reason: "Batch mismatch", compliant_qty: 0 });
    expect(lineBreach(l)).toBe("Yes");
    expect(lineTone(l)).toBe("bad");
  });

  it("non-expiry SKU: never a breach", () => {
    const l = line({ fefo_breach: "No", reason: "Non-expiry SKU" });
    expect(lineBreach(l)).toBe("No");
    expect(lineTone(l)).toBe("ok");
  });
});

describe("gatepass adherence line helpers — pre-Sep-2026 rows on `status`", () => {
  it("OK maps to no breach", () => {
    const l = { sku: "S", bin: "A", batch: "B", instructed_qty: 5, actual_qty: 5, compliant_qty: 5, status: "OK" } as AdherenceLine;
    expect(lineBreach(l)).toBe("No");
    expect(lineReason(l)).toBe("Bin & batch match");
    expect(lineTone(l)).toBe("ok");
  });

  it("PARTIAL maps to no breach, warn", () => {
    const l = { sku: "S", bin: "A", batch: "B", instructed_qty: 5, actual_qty: 3, compliant_qty: 3, status: "PARTIAL" } as AdherenceLine;
    expect(lineBreach(l)).toBe("No");
    expect(lineReason(l)).toBe("Partial pick — correct batch");
    expect(lineTone(l)).toBe("warn");
  });

  it("BIN BREACH maps to breach, bad", () => {
    const l = { sku: "S", bin: "A", batch: "B", instructed_qty: 5, actual_qty: 0, compliant_qty: 0, status: "BIN BREACH" } as AdherenceLine;
    expect(lineBreach(l)).toBe("Yes");
    expect(lineReason(l)).toBe("Batch mismatch");
    expect(lineTone(l)).toBe("bad");
  });
});
