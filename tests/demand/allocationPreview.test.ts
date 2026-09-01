import { describe, expect, it } from "vitest";
import { computeChannelAllocations } from "../../src/lib/store";
import { activeHoldKeys, holdKey } from "../../src/lib/holds";
import type { DemandLine, SkuInfo, StockRow } from "../../src/lib/types";

// Cutoff 0 + far-future expiry means every batch below always qualifies,
// regardless of what "today" is when the test runs — isolates the
// allocation and reservation logic from shelf-life filtering, which
// engine.ts already covers on its own.
const channelRules = { TestChannel: { type: "fixed" as const, val: 0 } };
const skus: Record<string, SkuInfo> = { "TEST-SKU": { name: "Test Product", shelf: 24 } };

function stockRow(overrides: Partial<StockRow>): StockRow {
  return {
    rid: 1,
    location: "SL Mother Hub",
    bin: "A1",
    sku: "TEST-SKU",
    name: "Test Product",
    batch: "B1",
    exp: [2099, 1],
    qty: 10,
    shelf: 24,
    type: "Good",
    active: "Active",
    ...overrides,
  };
}

function demandLine(overrides: Partial<DemandLine> = {}): DemandLine {
  return { channel: "TestChannel", sku: "TEST-SKU", qty: 20, gatePassNo: "GPSLMH-1001", ...overrides };
}

describe("computeChannelAllocations — channel minBinQty floor", () => {
  const minQtyChannelRules = { TestChannel: { type: "fixed" as const, val: 0, minBinQty: 20 } };

  it("skips a bin under the channel's floor and reports it, falling back to shortfall if nothing else qualifies", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 12 })];
    const demand: DemandLine[] = [demandLine({ qty: 5 })];
    const [result] = computeChannelAllocations(demand, minQtyChannelRules, skus, stock, []);
    expect(Object.keys(result.byFacility)).toEqual([]);
    expect(result.shortfall).toEqual([{ sku: "TEST-SKU", name: "Test Product", qty: 5 }]);
    expect(result.skipped).toEqual([
      { sku: "TEST-SKU", name: "Test Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", qtyAvailable: 12, threshold: 20 },
    ]);
  });

  it("does not skip anything for a channel with no minBinQty set", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 12 })];
    const demand: DemandLine[] = [demandLine({ qty: 5 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub"]);
    expect(result.skipped).toEqual([]);
  });
});

describe("computeChannelAllocations — one batch never over-promises the same bin across multiple channel groups", () => {
  // Real case: one demand upload with 5 different replenishment channels
  // (LJ Emiza Guwahati, LJ Emiza BLR, LJ Beyond NCR, LJ Beyond LUC, LJ
  // Ahmedabad) all needing the same SKU, gate passes GPSLMH9863/64/65/67/71.
  // Bin R14-C5-008 physically held 149 units; the app promised 71+71+71+
  // 24+71 = 308 — more than double what the bin actually had — because each
  // channel group's allocation only ever checked reservations from tasks
  // that existed BEFORE the whole batch started, never what earlier groups
  // in this SAME batch had already claimed.
  it("depletes a shared bin across channel groups instead of each one claiming the full untouched amount", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", batch: "BA036790", qty: 149 })];
    const demand: DemandLine[] = [
      { channel: "LJ Emiza Guwahati", sku: "TEST-SKU", qty: 71 },
      { channel: "LJ Emiza BLR", sku: "TEST-SKU", qty: 71 },
      { channel: "LJ Beyond NCR", sku: "TEST-SKU", qty: 71 },
      { channel: "LJ Beyond LUC", sku: "TEST-SKU", qty: 24 },
      { channel: "LJ Ahmedabad", sku: "TEST-SKU", qty: 71 },
    ];
    const fiveChannelRules = Object.fromEntries(
      demand.map((d) => [d.channel, { type: "fixed" as const, val: 0 }]),
    );
    const allocations = computeChannelAllocations(demand, fiveChannelRules, skus, stock, []);

    const totalAllocated = allocations.reduce(
      (sum, a) => sum + Object.values(a.byFacility).flat().reduce((s, l) => s + l.qty, 0),
      0,
    );
    const totalShortfall = allocations.reduce((sum, a) => sum + a.shortfall.reduce((s, sf) => s + sf.qty, 0), 0);

    expect(totalAllocated).toBeLessThanOrEqual(149); // never more than the bin actually had
    expect(totalAllocated + totalShortfall).toBe(71 + 71 + 71 + 24 + 71); // every unit accounted for, none silently dropped
    expect(totalShortfall).toBe(308 - 149); // the 159 units the bin genuinely couldn't cover show up as real shortfall
  });

  it("still lets an unrelated SKU in a later group allocate normally — the fix doesn't over-restrict", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", sku: "TEST-SKU", batch: "B1", qty: 20 }),
      stockRow({ rid: 2, location: "SL Mother Hub", sku: "OTHER-SKU", batch: "B2", qty: 50 }),
    ];
    const twoSkus = { ...skus, "OTHER-SKU": { name: "Other Product", shelf: 24 } };
    const demand: DemandLine[] = [
      { channel: "ChannelA", sku: "TEST-SKU", qty: 15 },
      { channel: "ChannelB", sku: "OTHER-SKU", qty: 30 },
    ];
    const twoChannelRules = { ChannelA: { type: "fixed" as const, val: 0 }, ChannelB: { type: "fixed" as const, val: 0 } };
    const allocations = computeChannelAllocations(demand, twoChannelRules, twoSkus, stock, []);
    expect(allocations[0].shortfall).toEqual([]);
    expect(allocations[1].shortfall).toEqual([]);
  });
});

describe("computeChannelAllocations (pure — no Supabase, no side effects)", () => {
  it("allocates within a single facility when its stock covers demand", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 50 })];
    const demand: DemandLine[] = [demandLine({ qty: 20 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(result.channel).toBe("TestChannel");
    expect(result.gatePassByFacility["SL Mother Hub"]).toBe("GPSLMH-1001");
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub"]);
    expect(result.shortfall).toEqual([]);
  });

  it("spills into a second facility once the first can't fully cover demand", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 30 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(Object.keys(result.byFacility).sort()).toEqual(["SL Ambient", "SL Mother Hub"]);
    expect(result.shortfall).toEqual([]);
  });

  it("picks the earliest-expiring lot regardless of facility — no facility-priority ordering", () => {
    // Mother Hub's lot expires later; Ambient's (checked second in the old
    // priority order) expires sooner. Pure FEFO must prefer Ambient's lot
    // even though it isn't "first" in any facility list.
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", batch: "LATE", exp: [2099, 12], qty: 20 }),
      stockRow({ rid: 2, location: "SL Ambient", batch: "EARLY", exp: [2099, 1], qty: 20 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 10 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(Object.keys(result.byFacility)).toEqual(["SL Ambient"]);
    expect(result.byFacility["SL Ambient"][0].batch).toBe("EARLY");
  });

  it("splits a single SKU's demand across facilities purely by expiry order, not facility order", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", batch: "LATE", exp: [2099, 12], qty: 20 }),
      stockRow({ rid: 2, location: "SL RX", batch: "MID", exp: [2099, 6], qty: 5 }),
      stockRow({ rid: 3, location: "SL Ambient", batch: "EARLY", exp: [2099, 1], qty: 5 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 10 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    // Earliest (Ambient) and next-earliest (RX) fully cover the 10 units
    // needed — Mother Hub's later-expiring, otherwise-untouched lot is
    // never drawn from at all.
    expect(Object.keys(result.byFacility).sort()).toEqual(["SL Ambient", "SL RX"]);
    expect(result.byFacility["SL Ambient"][0].qty).toBe(5);
    expect(result.byFacility["SL RX"][0].qty).toBe(5);
  });

  it("reports a shortage when no facility can cover the remaining need", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 5 })];
    const demand: DemandLine[] = [demandLine({ qty: 30 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(result.shortfall).toEqual([{ sku: "TEST-SKU", name: "Test Product", qty: 25 }]);
  });

  it("keeps demand already reserved by an existing open task out of a new allocation", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 15 })];
    const [first] = computeChannelAllocations(demand, channelRules, skus, stock, []);

    const reservingTask = {
      no: "TEST-001",
      gatePassNo: "GP-1001",
      channel: "TestChannel",
      demand,
      facilities: [
        {
          no: "TEST-001-MH",
          taskNo: "TEST-001",
          facility: "SL Mother Hub",
          status: "open" as const,
          round: 1,
          bad: 0,
          lines: first.byFacility["SL Mother Hub"],
        },
      ],
      shortfall: [],
      createdAt: new Date().toISOString(),
    };

    // The first request already reserved all 15 units at Mother Hub, so an
    // identical second request must fall entirely to Ambient instead of
    // double-allocating the same (still-unpicked) batch.
    const [second] = computeChannelAllocations(demand, channelRules, skus, stock, [reservingTask]);
    expect(Object.keys(second.byFacility)).toEqual(["SL Ambient"]);
  });

  it("skips a channel with no configured tolerance rule instead of throwing", () => {
    const stock: StockRow[] = [stockRow({ rid: 1 })];
    const demand: DemandLine[] = [demandLine({ channel: "Not A Real Channel", qty: 5 })];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(result).toEqual([]);
  });

  it("groups by (channel, gate pass) — same channel, different gate passes, become two separate picklists", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 100 })];
    const demand: DemandLine[] = [
      demandLine({ sku: "TEST-SKU", qty: 5, gatePassNo: "GPSLMH-1001" }),
      demandLine({ sku: "TEST-SKU", qty: 7, gatePassNo: "GPSLMH-1002" }),
    ];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(result).toHaveLength(2);
    const byGp = (gp: string) => result.find((r) => r.gatePassByFacility["SL Mother Hub"] === gp)!;
    expect(byGp("GPSLMH-1001").byFacility["SL Mother Hub"].reduce((s, l) => s + l.qty, 0)).toBe(5);
    expect(byGp("GPSLMH-1002").byFacility["SL Mother Hub"].reduce((s, l) => s + l.qty, 0)).toBe(7);
  });

  it("groups blank-gate-pass rows for the same channel in one upload into a single pending order", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 100 })];
    const demand: DemandLine[] = [
      demandLine({ sku: "TEST-SKU", qty: 5, gatePassNo: undefined }),
      demandLine({ sku: "TEST-SKU", qty: 7, gatePassNo: undefined }),
    ];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(result).toHaveLength(1);
    expect(result[0].byFacility["SL Mother Hub"].reduce((s, l) => s + l.qty, 0)).toBe(12);
    expect(result[0].gatePassByFacility["SL Mother Hub"]).toBeUndefined();
  });

  it("resolves each facility's gate pass strictly by prefix — a Mother Hub number never applies to Ambient", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 20 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 20 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 40, gatePassNo: "GPSLMH-9999" })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(Object.keys(result.byFacility).sort()).toEqual(["SL Ambient", "SL Mother Hub"]);
    expect(result.gatePassByFacility["SL Mother Hub"]).toBe("GPSLMH-9999");
    expect(result.gatePassByFacility["SL Ambient"]).toBeUndefined();
    expect(result.unusedGatePasses).toEqual([]);
  });

  it("reports a supplied gate pass as unused when it matches no facility this order actually allocated to", () => {
    // Only Ambient stock exists, but the Planner supplied a Mother Hub gate
    // pass — it must not be silently applied to Ambient's picklist.
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Ambient", qty: 20 })];
    const demand: DemandLine[] = [demandLine({ qty: 10, gatePassNo: "GPSLMH-1234" })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, []);
    expect(Object.keys(result.byFacility)).toEqual(["SL Ambient"]);
    expect(result.gatePassByFacility["SL Ambient"]).toBeUndefined();
    expect(result.unusedGatePasses).toEqual(["GPSLMH-1234"]);
  });

  it("merges multiple SKUs under the same gate pass into one picklist", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, sku: "TEST-SKU", qty: 100 }),
      stockRow({ rid: 2, sku: "TEST-SKU-2", qty: 100 }),
    ];
    const skus2: Record<string, SkuInfo> = { ...skus, "TEST-SKU-2": { name: "Second Product", shelf: 24 } };
    const demand: DemandLine[] = [
      demandLine({ sku: "TEST-SKU", qty: 4, gatePassNo: "GP-1001" }),
      demandLine({ sku: "TEST-SKU-2", qty: 6, gatePassNo: "GP-1001" }),
    ];
    const result = computeChannelAllocations(demand, channelRules, skus2, stock, []);
    expect(result).toHaveLength(1);
    expect(result[0].byFacility["SL Mother Hub"].map((l) => l.sku).sort()).toEqual(["TEST-SKU", "TEST-SKU-2"]);
  });

  it("skips a held batch and allocates from an unheld one for the same sku+bin", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", batch: "B1", qty: 20 }),
      stockRow({ rid: 2, location: "SL Mother Hub", batch: "B2", qty: 20 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 10 })];
    const heldKeys = activeHoldKeys([
      { id: 1, sku: "TEST-SKU", facility: "SL Mother Hub", bin: "A1", batch: "B1", heldAt: "2026-08-08T00:00:00.000Z", heldBy: "Admin" },
    ]);
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, [], heldKeys);
    const lines = result.byFacility["SL Mother Hub"];
    expect(lines.every((l) => l.batch === "B2")).toBe(true);
  });
});
