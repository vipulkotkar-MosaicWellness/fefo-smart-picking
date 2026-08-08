import { describe, expect, it } from "vitest";
import { allocate } from "../../src/lib/engine";
import { holdKey } from "../../src/lib/holds";
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

describe("allocate — excludes held stock", () => {
  it("never allocates a sku+facility+bin+batch combination that's on hold, even when it's the only stock available", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 50 })];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toEqual([]);
    expect(result.short).toBe(10);
  });

  it("skips the held batch and allocates from an unheld batch of the same sku+bin instead", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "B1", qty: 50 }),
      stockRow({ rid: 2, batch: "B2", qty: 20 }),
    ];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("B2");
  });

  it("does not affect a different sku sitting on the same held bin", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, sku: "SKU-2", batch: "B9", qty: 20 })];
    const heldKeys = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    const result = allocate({ sku: "SKU-2", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, heldKeys });
    expect(result.lines).toHaveLength(1);
  });

  it("allocates normally when heldKeys is omitted", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, qty: 50 })];
    const result = allocate({ sku: "SKU-1", need: 10, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0 });
    expect(result.lines).toHaveLength(1);
  });
});
