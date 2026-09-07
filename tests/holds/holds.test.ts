import { describe, expect, it } from "vitest";
import {
  activeHoldKeys,
  AGE_BUCKETS,
  dueForHoldAutoRelease,
  groupHoldsByFacilityAndDate,
  holdAgeDays,
  holdKey,
  holdMatchesAgeBucket,
  holdMatchesSearch,
  holdsToCreate,
  onHandQty,
} from "../../src/lib/holds";
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

describe("holdMatchesSearch", () => {
  it("matches on sku, bin, or batch, case-insensitively", () => {
    const h = hold({ sku: "MWBWSKP.00206.B0_N", bin: "R13-C11-001", batch: "BA029520" });
    expect(holdMatchesSearch(h, "mwbwskp")).toBe(true);
    expect(holdMatchesSearch(h, "R13-C11")).toBe(true);
    expect(holdMatchesSearch(h, "ba029520")).toBe(true);
  });

  it("does not match a field it wasn't asked about", () => {
    const h = hold({ sku: "SKU-1", bin: "A1", batch: "B1", facility: "SL Mother Hub" });
    expect(holdMatchesSearch(h, "mother hub")).toBe(false);
  });

  it("an empty search matches everything", () => {
    expect(holdMatchesSearch(hold(), "")).toBe(true);
    expect(holdMatchesSearch(hold(), "   ")).toBe(true);
  });
});

describe("groupHoldsByFacilityAndDate", () => {
  const order = ["SL Mother Hub", "SL Ambient", "SL RX"];

  it("groups by facility in the given priority order, then by date newest-first within each", () => {
    const holds = [
      hold({ id: 1, facility: "SL Ambient", heldAt: "2026-08-01T10:00:00.000Z" }),
      hold({ id: 2, facility: "SL Mother Hub", heldAt: "2026-08-03T10:00:00.000Z" }),
      hold({ id: 3, facility: "SL Mother Hub", heldAt: "2026-08-01T10:00:00.000Z" }),
    ];
    const groups = groupHoldsByFacilityAndDate(holds, order);
    expect(groups.map((g) => g.facility)).toEqual(["SL Mother Hub", "SL Ambient"]);
    expect(groups[0].dates.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-01"]);
    expect(groups[0].dates[0].holds.map((h) => h.id)).toEqual([2]);
  });

  it("sorts holds within one date newest-first", () => {
    const holds = [
      hold({ id: 1, heldAt: "2026-08-01T09:00:00.000Z" }),
      hold({ id: 2, heldAt: "2026-08-01T15:00:00.000Z" }),
    ];
    const groups = groupHoldsByFacilityAndDate(holds, order);
    expect(groups[0].dates[0].holds.map((h) => h.id)).toEqual([2, 1]);
  });

  it("puts a facility not in the priority list after the known ones, instead of dropping it", () => {
    const holds = [hold({ id: 1, facility: "SL Warehouse Old" }), hold({ id: 2, facility: "SL Mother Hub" })];
    const groups = groupHoldsByFacilityAndDate(holds, order);
    expect(groups.map((g) => g.facility)).toEqual(["SL Mother Hub", "SL Warehouse Old"]);
  });
});

describe("holdAgeDays", () => {
  const now = new Date("2026-09-07T18:00:00.000Z");

  it("is 0 for a hold placed earlier today", () => {
    expect(holdAgeDays("2026-09-07T09:00:00.000Z", now)).toBe(0);
  });

  it("counts whole calendar days, not elapsed hours", () => {
    // Placed 15:00 yesterday, "now" is 18:00 today — only 1 calendar day apart.
    expect(holdAgeDays("2026-09-06T15:00:00.000Z", now)).toBe(1);
  });

  it("counts a hold from 11 days ago as 11", () => {
    expect(holdAgeDays("2026-08-27T10:00:00.000Z", now)).toBe(11);
  });
});

describe("AGE_BUCKETS / holdMatchesAgeBucket", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  function heldDaysAgo(days: number): Hold {
    const d = new Date(now.getTime() - days * 86400000);
    return hold({ heldAt: d.toISOString() });
  }

  it("buckets < 2 days as lt2", () => {
    expect(holdMatchesAgeBucket(heldDaysAgo(0), "lt2", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(1), "lt2", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(2), "lt2", now)).toBe(false);
  });

  it("buckets 3-5 days as 3to5", () => {
    expect(holdMatchesAgeBucket(heldDaysAgo(2), "3to5", now)).toBe(false);
    expect(holdMatchesAgeBucket(heldDaysAgo(3), "3to5", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(5), "3to5", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(6), "3to5", now)).toBe(false);
  });

  it("buckets 6-10 days as 6to10", () => {
    expect(holdMatchesAgeBucket(heldDaysAgo(6), "6to10", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(10), "6to10", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(11), "6to10", now)).toBe(false);
  });

  it("buckets > 10 days as gt10", () => {
    expect(holdMatchesAgeBucket(heldDaysAgo(10), "gt10", now)).toBe(false);
    expect(holdMatchesAgeBucket(heldDaysAgo(11), "gt10", now)).toBe(true);
    expect(holdMatchesAgeBucket(heldDaysAgo(30), "gt10", now)).toBe(true);
  });

  it("a null bucket matches everything", () => {
    expect(holdMatchesAgeBucket(heldDaysAgo(30), null, now)).toBe(true);
  });

  it("exposes exactly 4 buckets with their user-facing labels", () => {
    expect(AGE_BUCKETS.map((b) => b.label)).toEqual(["< 2 days", "3 to 5 days", "6 to 10 days", "> 10 days"]);
  });
});
