import { describe, expect, it } from "vitest";
import { allocate, isExceptionBin } from "../../src/lib/engine";
import type { StockRow } from "../../src/lib/types";

function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  return {
    rid: 1,
    location: "SL Mother Hub",
    bin: "A1",
    sku: "SKU-1",
    name: "Product 1",
    batch: "B1",
    exp: [2099, 1],
    qty: 10,
    shelf: 24,
    type: "Good",
    active: "Active",
    ...overrides,
  };
}

describe("isExceptionBin", () => {
  it("flags a bin starting with CC-NTF, regardless of the sequence number", () => {
    expect(isExceptionBin("CC-NTF-001")).toBe(true);
    expect(isExceptionBin("CC-NTF-042")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isExceptionBin("cc-ntf-001")).toBe(true);
  });

  it("flags any bin containing NTF anywhere, not just as a prefix", () => {
    expect(isExceptionBin("SLM-NTF-A1")).toBe(true);
    expect(isExceptionBin("A1-NTF")).toBe(true);
    expect(isExceptionBin("NTF001")).toBe(true);
  });

  it("does not flag an ordinary bin", () => {
    expect(isExceptionBin("A1")).toBe(false);
    expect(isExceptionBin("SLM-A1")).toBe(false);
  });
});

describe("allocate — excludes not-found exception bins", () => {
  it("never allocates from a CC-NTF bin, even when it's the only stock available", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, bin: "CC-NTF-001", qty: 50 })];
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toEqual([]);
    expect(result.short).toBe(10);
  });

  it("skips a CC-NTF bin and allocates from a normal bin instead", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, bin: "CC-NTF-001", qty: 50, exp: [2050, 1] }),
      stockRow({ rid: 2, bin: "A1", qty: 20, exp: [2099, 1] }),
    ];
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].bin).toBe("A1");
  });
});
