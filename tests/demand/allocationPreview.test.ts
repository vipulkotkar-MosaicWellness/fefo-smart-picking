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

function demandLine(overrides: Partial<DemandLine> = {}): DemandLine {
  return { channel: "TestChannel", sku: "TEST-SKU", qty: 20, gatePassNo: "GP-1001", ...overrides };
}

describe("computeChannelAllocations (pure — no Supabase, no side effects)", () => {
  it("allocates within a single facility when its stock covers demand", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 50 })];
    const demand: DemandLine[] = [demandLine({ qty: 20 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result.channel).toBe("TestChannel");
    expect(result.gatePassNo).toBe("GP-1001");
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub"]);
    expect(result.shortfall).toEqual([]);
  });

  it("waterfalls into the next facility once the first can't fully cover demand", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 30 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(Object.keys(result.byFacility)).toEqual(["SL Mother Hub", "SL Ambient"]);
    expect(result.shortfall).toEqual([]);
  });

  it("reports a shortage when no facility can cover the remaining need", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 5 })];
    const demand: DemandLine[] = [demandLine({ qty: 30 })];
    const [result] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result.shortfall).toEqual([{ sku: "TEST-SKU", name: "Test Product", qty: 25 }]);
  });

  it("keeps demand already reserved by an existing open task out of a new allocation", () => {
    const stock: StockRow[] = [
      stockRow({ rid: 1, location: "SL Mother Hub", qty: 15 }),
      stockRow({ rid: 2, location: "SL Ambient", qty: 50 }),
    ];
    const demand: DemandLine[] = [demandLine({ qty: 15 })];
    const [first] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);

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
    // identical second request must waterfall entirely into Ambient instead
    // of double-allocating the same (still-unpicked) batch.
    const [second] = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, [reservingTask]);
    expect(Object.keys(second.byFacility)).toEqual(["SL Ambient"]);
  });

  it("skips a channel with no configured tolerance rule instead of throwing", () => {
    const stock: StockRow[] = [stockRow({ rid: 1 })];
    const demand: DemandLine[] = [demandLine({ channel: "Not A Real Channel", qty: 5 })];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result).toEqual([]);
  });

  it("groups by (channel, gate pass) — same channel, different gate passes, become two separate picklists", () => {
    const stock: StockRow[] = [stockRow({ rid: 1, location: "SL Mother Hub", qty: 100 })];
    const demand: DemandLine[] = [
      demandLine({ sku: "TEST-SKU", qty: 5, gatePassNo: "GP-1001" }),
      demandLine({ sku: "TEST-SKU", qty: 7, gatePassNo: "GP-1002" }),
    ];
    const result = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, []);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.gatePassNo).sort()).toEqual(["GP-1001", "GP-1002"]);
    const gp1 = result.find((r) => r.gatePassNo === "GP-1001")!;
    const gp2 = result.find((r) => r.gatePassNo === "GP-1002")!;
    expect(gp1.byFacility["SL Mother Hub"].reduce((s, l) => s + l.qty, 0)).toBe(5);
    expect(gp2.byFacility["SL Mother Hub"].reduce((s, l) => s + l.qty, 0)).toBe(7);
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
    const result = computeChannelAllocations(demand, channelRules, skus2, stock, facilityPriority, []);
    expect(result).toHaveLength(1);
    expect(result[0].byFacility["SL Mother Hub"].map((l) => l.sku).sort()).toEqual(["TEST-SKU", "TEST-SKU-2"]);
  });
});
