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

describe("allocate — same-month FEFO tiebreak", () => {
  it("prefers the earlier exact expiry date when two lots tie at month-level rem", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "LATE", bin: "A1", exp: [2027, 8], expDate: "2027-08-31", qty: 10 }),
      stockRow({ rid: 2, batch: "EARLY", bin: "A2", exp: [2027, 8], expDate: "2027-08-01", qty: 10 }),
    ];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, today: new Date("2026-08-22") });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("EARLY");
  });

  it("still lets the later-in-month lot fill the remainder once the earlier one is exhausted", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "LATE", bin: "A1", exp: [2027, 8], expDate: "2027-08-31", qty: 10 }),
      stockRow({ rid: 2, batch: "EARLY", bin: "A2", exp: [2027, 8], expDate: "2027-08-01", qty: 3 }),
    ];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, today: new Date("2026-08-22") });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].batch).toBe("EARLY");
    expect(result.lines[0].qty).toBe(3);
    expect(result.lines[1].batch).toBe("LATE");
    expect(result.lines[1].qty).toBe(2);
  });

  it("falls back to existing (array-order) behavior when expDate is missing on either side", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "FIRST-IN-ARRAY", bin: "A1", exp: [2027, 8], qty: 10 }),
      stockRow({ rid: 2, batch: "SECOND-IN-ARRAY", bin: "A2", exp: [2027, 8], qty: 10 }),
    ];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, today: new Date("2026-08-22") });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("FIRST-IN-ARRAY");
  });

  it("still lets an earlier calendar month win outright regardless of exact day", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, batch: "SEPT-EARLY-DAY", bin: "A1", exp: [2027, 9], expDate: "2027-09-01", qty: 10 }),
      stockRow({ rid: 2, batch: "AUG-LATE-DAY", bin: "A2", exp: [2027, 8], expDate: "2027-08-31", qty: 10 }),
    ];
    const result = allocate({ sku: "SKU-1", need: 5, location: "SL Mother Hub", cutoff: 0, stock, reservedFor: () => 0, today: new Date("2026-08-22") });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].batch).toBe("AUG-LATE-DAY");
  });
});
