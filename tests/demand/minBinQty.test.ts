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
    exp: [2099, 1],
    qty: 10,
    shelf: 24,
    type: "Good",
    active: "Active",
    ...overrides,
  };
}

describe("allocate — minQty (channel-level minimum bin quantity)", () => {
  it("skips a bin under the floor and reports it, instead of allocating from it", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 12 })];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, minQty: 20 });
    expect(result.lines).toEqual([]);
    expect(result.short).toBe(5);
    expect(result.skipped).toEqual([
      { sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "B1", qtyAvailable: 12, threshold: 20 },
    ]);
  });

  it("allocates normally from a bin that clears the floor", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 25 })];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, minQty: 20 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].qty).toBe(5);
    expect(result.skipped).toEqual([]);
  });

  it("skips a lot just under the floor and falls back to the next FEFO-eligible lot that clears it", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "B1", exp: [2099, 1], qty: 15 }), // earlier-expiring but under the floor
      stockRow({ rid: 2, batch: "B2", exp: [2099, 6], qty: 30 }), // later-expiring but clears the floor
    ];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, minQty: 20 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("B2");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].batch).toBe("B1");
  });

  it("does not flag a bin with zero available qty as skipped — that's just unavailable, not a floor violation", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 5 })];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 5, minQty: 20 });
    expect(result.skipped).toEqual([]);
  });

  it("does not skip anything when minQty is omitted — existing behavior for every other channel", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 3 })];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });
});
