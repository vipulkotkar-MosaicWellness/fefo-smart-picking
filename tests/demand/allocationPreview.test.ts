import { describe, expect, it } from "vitest";
import { computeChannelAllocations } from "../../src/lib/store";
import type { DemandLine, SkuInfo, StockRow } from "../../src/lib/types";

// Cutoff 0 + far-future expiry means every batch below always qualifies,
// regardless of what "today" is when the test runs — isolates the waterfall
// and reservation logic from shelf-life filtering, which engine.ts already
// covers on its own.
const channelRules = { TestChannel: { type: "fixed" as const, val: 0 } };
const skus: Record<string, SkuInfo> = { "TEST-SKU": { name: "Test Product", shelf: 24 } };
const facilityPriority = ["SL Mother Hub", "SL Ambient"];

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

describe("computeChannelAllocations (pure — no Supabase, no side effects)", () => {
  it("allocates within a single facility when its stock covers demand", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 50 })];
    const demand: DemandLine[] = [{ channel: "TestChannel", sku: "TEST-SKU", qty: 20 }];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result.channel).toBe("TestChannel");
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub"]);
    expect(result.shortfall).toEqual([]);
  });

  it("waterfalls into the next facility once the first can't fully cover demand", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [{ channel: "TestChannel", sku: "TEST-SKU", qty: 30 }];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub", "SL Ambient"]);
    expect(result.shortfall).toEqual([]);
  });

  it("reports a shortage when no facility can cover the remaining need", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 5 })];
    const demand: DemandLine[] = [{ channel: "TestChannel", sku: "TEST-SKU", qty: 30 }];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result.shortfall).toEqual([{ sku: "TEST-SKU", name: "Test Product", qty: 25 }]);
  });

  it("keeps demand already reserved by an existing open task out of a new allocation", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [{ channel: "TestChannel", sku: "TEST-SKU", qty: 15 }];
    const [first] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);

    const reservingTask = {
      no: "TEST-001",
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
    // identical second request must waterfall entirely into Ambient instead
    // of double-allocating the same (still-unpicked) batch.
    const [second] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, [reservingTask]);
    expect(Object.keys(second.byFacility)).toEqual(["SL Ambient"]);
  });

  it("skips a channel with no configured tolerance rule instead of throwing", () => {
    const stock: StockRow[] = [stockRow({ rid: 1 })];
    const demand: DemandLine[] = [{ channel: "Not A Real Channel", sku: "TEST-SKU", qty: 5 }];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result).toEqual([]);
  });
});
