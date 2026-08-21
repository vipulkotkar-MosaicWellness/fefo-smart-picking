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
