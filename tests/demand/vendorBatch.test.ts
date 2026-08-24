import { describe, expect, it } from "vitest";
import { allocate } from "../../src/lib/engine";
import type { StockRow } from "../../src/lib/types";

function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  return {
    rid: 1,
    location: "SL Mother Hub",
    bin: "A1",
    sku: "SKU-1",
    name: "Product 1",
    batch: "B1",
    exp: [2027, 8],
    qty: 10,
    shelf: 24,
    type: "Good",
    active: "Active",
    ...overrides,
  };
}

describe("allocate — vendor batch passthrough", () => {
  it("carries a stock row's vendorBatch onto the resulting pick line", () => {
    const stock: StockRow[] = [stockRow({ vendorBatch: "NJ6369" })];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].vendorBatch).toBe("NJ6369");
  });

  it("leaves vendorBatch undefined when the stock row doesn't have one", () => {
    const stock: StockRow[] = [stockRow()];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines[0].vendorBatch).toBeUndefined();
  });
});
