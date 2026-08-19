import { describe, expect, it } from "vitest";
import { activeHoldKeys, dueForHoldAutoRelease, holdKey, holdsToCreate, onHandQty } from "../../src/lib/holds";
import type { Hold, StockRow } from "../../src/lib/types";

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

function hold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: 1,
    sku: "SKU-1",
    facility: "SL Mother Hub",
    bin: "A1",
    batch: "B1",
    heldAt: "2026-08-08T10:00:00.000Z",
    heldBy: "Admin",
    ...overrides,
  };
}

describe("holdKey", () => {
  it("combines sku, facility, bin, and batch into one string", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).toBe("SKU-1::SL Mother Hub::A1::B1");
  });

  it("produces different keys for different batches of the same sku+bin", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).not.toBe(holdKey("SKU-1", "SL Mother Hub", "A1", "B2"));
  });
});

describe("activeHoldKeys", () => {
  it("includes a hold with no releasedAt", () => {
    const keys = activeHoldKeys([hold()]);
    expect(keys.has(holdKey("SKU-1", "SL Mother Hub", "A1", "B1"))).toBe(true);
  });

  it("excludes a hold that has been released", () => {
    const keys = activeHoldKeys([hold({ releasedAt: "2026-08-09T10:00:00.000Z", releasedBy: "Admin" })]);
    expect(keys.size).toBe(0);
  });
});

describe("dueForHoldAutoRelease", () => {
  it("flags an active hold whose lot currently has zero stock", () => {
    const stock: StockRow[] = [stockRow({ qty: 0 })];
    expect(dueForHoldAutoRelease([hold()], stock).map((h) => h.id)).toEqual([1]);
  });

  it("flags an active hold whose lot is entirely absent from the latest stock sync", () => {
    expect(dueForHoldAutoRelease([hold()], []).map((h) => h.id)).toEqual([1]);
  });

  it("does not flag a hold whose lot still has stock", () => {
    const stock: StockRow[] = [stockRow({ qty: 4 })];
    expect(dueForHoldAutoRelease([hold()], stock)).toEqual([]);
  });

  it("does not re-flag a hold that's already been released", () => {
    const stock: StockRow[] = [stockRow({ qty: 0 })];
    const released = hold({ releasedAt: "2026-08-09T10:00:00.000Z", releasedBy: "Admin" });
    expect(dueForHoldAutoRelease([released], stock)).toEqual([]);
  });
});

describe("holdsToCreate", () => {
  // Worked example: bin qty 100, pick qty 10, picked 5, not-found 5 ->
  // hold qty should be 95 (100 - 5 picked), NOT 5 (the not-found count).
  // applyPicks() already deducts picked from stock before calling this, so
  // the qty here is read straight off the (already-deducted) stock passed in.
  it("uses the live stock level (post-pick-deduction), not the not-found count, as the hold qty", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 5, nfReason: "Damaged stock" }];
    const stock = [stockRow({ qty: 95 })]; // caller already subtracted the 5 picked from the original 100
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set(), stock);
    expect(out).toEqual([{ sku: "SKU-1", facility: "SL Mother Hub", bin: "A1", batch: "B1", qty: 95, reason: "Damaged stock", sourceTaskNo: "PT-001" }]);
  });

  it("skips a line with no not-found quantity", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 0 }];
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set(), [])).toEqual([]);
  });

  it("skips a combination that's already actively held", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 }];
    const existing = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", existing, [stockRow({ qty: 95 })])).toEqual([]);
  });

  it("de-duplicates two not-found lines that share the same sku+bin+batch into one hold, reading the shared stock level once", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 3 },
    ];
    const stock = [stockRow({ qty: 95 })];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set(), stock);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(95);
  });

  it("keeps two different skus on the same bin as two separate hold requests, each with its own stock level", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-2", bin: "A1", batch: "B9", nf: 5 },
    ];
    const stock = [stockRow({ sku: "SKU-1", batch: "B1", qty: 95 }), stockRow({ sku: "SKU-2", batch: "B9", qty: 40 })];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set(), stock);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.sku === "SKU-1")?.qty).toBe(95);
    expect(out.find((r) => r.sku === "SKU-2")?.qty).toBe(40);
  });
});

describe("onHandQty", () => {
  it("returns the current qty for the exact sku+facility+bin+batch", () => {
    const stock = [stockRow({ qty: 842 })];
    expect(onHandQty(stock, "SKU-1", "SL Mother Hub", "A1", "B1")).toBe(842);
  });

  it("returns 0 when nothing on the live stock sheet matches anymore", () => {
    const stock = [stockRow({ qty: 842 })];
    expect(onHandQty(stock, "SKU-1", "SL Mother Hub", "A1", "B2")).toBe(0);
  });

  it("does not count a different sku on the same bin+batch", () => {
    const stock = [stockRow({ sku: "SKU-2", qty: 50 })];
    expect(onHandQty(stock, "SKU-1", "SL Mother Hub", "A1", "B1")).toBe(0);
  });

  it("sums quantity across multiple rows that share the same identity", () => {
    const stock = [stockRow({ rid: 1, qty: 5 }), stockRow({ rid: 2, qty: 7 })];
    expect(onHandQty(stock, "SKU-1", "SL Mother Hub", "A1", "B1")).toBe(12);
  });
});
