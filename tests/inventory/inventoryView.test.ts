import { describe, expect, it } from "vitest";
import { filterStock, paginate, sortStock } from "../../src/lib/inventoryView";
import type { StockRow } from "../../src/lib/types";

function row(overrides: Partial<StockRow>): StockRow {
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

describe("filterStock", () => {
  it("keeps only visible facilities, Good + Active + qty > 0 by default", () => {
    const rows = [
      row({ rid: 1, location: "SL Mother Hub" }),
      row({ rid: 2, location: "SL RX" }),
      row({ rid: 3, type: "Damaged" }),
      row({ rid: 4, qty: 0 }),
    ];
    const out = filterStock(rows, { visibleFacilities: ["SL Mother Hub"] });
    expect(out.map((r) => r.rid)).toEqual([1]);
  });

  it("filters by SKU or product name text", () => {
    const rows = [row({ rid: 1, sku: "ABC-1", name: "Shampoo" }), row({ rid: 2, sku: "XYZ-2", name: "Gummies" })];
    const out = filterStock(rows, { visibleFacilities: ["SL Mother Hub"], text: "gummies" });
    expect(out.map((r) => r.rid)).toEqual([2]);
  });

  it("filters by batch code", () => {
    const rows = [row({ rid: 1, batch: "BATCH-A" }), row({ rid: 2, batch: "BATCH-B" })];
    const out = filterStock(rows, { visibleFacilities: ["SL Mother Hub"], batch: "batch-a" });
    expect(out.map((r) => r.rid)).toEqual([1]);
  });

  it("filters by a location/bin substring", () => {
    const rows = [row({ rid: 1, bin: "A1" }), row({ rid: 2, bin: "B7" })];
    const out = filterStock(rows, { visibleFacilities: ["SL Mother Hub"], location: "a1" });
    expect(out.map((r) => r.rid)).toEqual([1]);
  });

  it("filters by a minimum on-hand quantity", () => {
    const rows = [row({ rid: 1, qty: 5 }), row({ rid: 2, qty: 50 })];
    const out = filterStock(rows, { visibleFacilities: ["SL Mother Hub"], minQty: 10 });
    expect(out.map((r) => r.rid)).toEqual([2]);
  });
});

describe("sortStock", () => {
  it("defaults to earliest eligible expiry first", () => {
    const rows = [row({ rid: 1, exp: [2028, 6] }), row({ rid: 2, exp: [2026, 11] }), row({ rid: 3, exp: [2027, 3] })];
    const out = sortStock(rows, "expiry");
    expect(out.map((r) => r.rid)).toEqual([2, 3, 1]);
  });

  it("can sort by facility then bin path instead", () => {
    const rows = [row({ rid: 1, location: "SL RX", bin: "A1" }), row({ rid: 2, location: "SL Mother Hub", bin: "B1" })];
    const out = sortStock(rows, "facility");
    expect(out.map((r) => r.rid)).toEqual([2, 1]);
  });
});

describe("paginate", () => {
  it("slices to the requested page and reports total pages", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ rid: i + 1 }));
    const { items, totalPages } = paginate(rows, 1, 10);
    expect(items).toHaveLength(10);
    expect(items[0].rid).toBe(1);
    expect(totalPages).toBe(3);
  });

  it("returns the correct slice for a later page", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ rid: i + 1 }));
    const { items } = paginate(rows, 3, 10);
    expect(items.map((r) => r.rid)).toEqual([21, 22, 23, 24, 25]);
  });
});
