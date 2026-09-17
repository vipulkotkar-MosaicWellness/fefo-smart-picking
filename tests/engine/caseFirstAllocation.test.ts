// tests/engine/caseFirstAllocation.test.ts
import { describe, expect, it } from "vitest";
import { allocate } from "../../src/lib/engine";
import type { StockRow } from "../../src/lib/types";

const TODAY = new Date("2026-09-17");

function lot(rid: number, bin: string, batch: string, exp: [number, number], qty: number, expDate?: string): StockRow {
  return {
    rid, location: "SL Mother Hub", bin, sku: "SKU-CASE", name: "Product", batch,
    exp, expDate, qty, shelf: 24, type: "Good", active: "Active",
  };
}

const noReserve = () => 0;

describe("allocate() — caseSize omitted or <=1 behaves exactly as plain FEFO", () => {
  it("caseSize omitted: identical to today's single-pass behavior", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50)];
    const r = allocate({ sku: "SKU-CASE", need: 30, cutoff: 0, stock, reservedFor: noReserve, today: TODAY });
    expect(r.lines).toEqual([
      { rid: 1, sku: "SKU-CASE", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", vendorBatch: undefined, exp: [2027, 1], rem: expect.any(Number), qty: 30 },
    ]);
    expect(r.short).toBe(0);
  });

  it("caseSize of 1: identical to today's single-pass behavior", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50)];
    const r = allocate({ sku: "SKU-CASE", need: 30, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 1 });
    expect(r.lines[0].qty).toBe(30);
    expect(r.lines[0].caseQty).toBeUndefined();
    expect(r.lines[0].eachQty).toBeUndefined();
  });
});

describe("allocate() — case-first, real worked examples from the approved simulation", () => {
  it("basic split: 200 demand, case size 30 -> 6 cases + 20 eaches from one lot", () => {
    // The exact example from the design discussion: 200 units, case 30 -> 6*30=180 + 20 eaches.
    const stock = [lot(1, "A1", "B1", [2027, 1], 500)];
    const r = allocate({ sku: "SKU-CASE", need: 200, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 30 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(180);
    expect(r.lines[0].eachQty).toBe(20);
    expect(r.lines[0].qty).toBe(200);
    expect(r.short).toBe(0);
  });

  it("shelf-level example: 190 units, case size 20 -> 9 cases (180) + 10 eaches, all from that one lot", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 190)];
    const r = allocate({ sku: "SKU-CASE", need: 190, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(180);
    expect(r.lines[0].eachQty).toBe(10);
  });

  it("real production case: fragmented small bins get skipped for a single bin big enough to yield a whole case, even though it expires far later", () => {
    // MWBWSKP.00206.B0_N, MP Kolkata, Aug 25 2026, case size 300, need 300 —
    // real incident from the approved simulation. Earliest lots (Mar/Apr
    // 2029) are all too small individually to form one case; the first lot
    // big enough is Feb 2030 — 10 months later.
    const stock: StockRow[] = [
      lot(1, "A1", "MAR29", [2029, 3], 74, "2029-03-15"),
      lot(2, "A2", "APR29-1", [2029, 4], 10, "2029-04-01"),
      lot(3, "A3", "APR29-2", [2029, 4], 24, "2029-04-02"),
      lot(4, "A4", "APR29-3", [2029, 4], 254, "2029-04-03"),
      lot(5, "A5", "APR29-4", [2029, 4], 7, "2029-04-04"),
      lot(6, "A6", "APR29-5", [2029, 4], 2, "2029-04-05"),
      lot(7, "A7", "APR29-6", [2029, 4], 13, "2029-04-06"),
      lot(8, "A8", "APR29-7", [2029, 4], 80, "2029-04-07"),
      lot(9, "A9", "APR29-8", [2029, 4], 12, "2029-04-08"),
      lot(10, "A10", "APR29-9", [2029, 4], 11, "2029-04-09"),
      lot(11, "R13-C11-001", "FEB30", [2030, 2], 520, "2030-02-01"),
    ];
    const r = allocate({ sku: "SKU-CASE", need: 300, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 300 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].bin).toBe("R13-C11-001");
    expect(r.lines[0].caseQty).toBe(300);
    expect(r.lines[0].eachQty).toBeUndefined();
    expect(r.short).toBe(0);
  });

  it("Pass 2 falls back to loose eaches, FEFO order, including a lot Pass 1 skipped entirely", () => {
    // Case size 100. Lot A (earliest) has 40 units — too small for a case,
    // Pass 1 skips it entirely. Lot B (next) has 250 -> 2 cases (200) + 50
    // eaches available. Need 220: Pass 1 takes 2 cases (200) from Lot B,
    // Pass 2 needs 20 more -> takes it from Lot A (earliest remaining eaches).
    const stock = [
      lot(1, "A1", "EARLY", [2027, 1], 40, "2027-01-15"),
      lot(2, "A2", "LATE", [2027, 6], 250, "2027-06-15"),
    ];
    const r = allocate({ sku: "SKU-CASE", need: 220, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 100 });
    expect(r.lines).toHaveLength(2);
    const early = r.lines.find((l) => l.bin === "A1")!;
    const late = r.lines.find((l) => l.bin === "A2")!;
    expect(early.caseQty).toBeUndefined();
    expect(early.eachQty).toBe(20);
    expect(late.caseQty).toBe(200);
    expect(late.eachQty).toBeUndefined();
    expect(r.short).toBe(0);
  });

  it("one lot contributing to BOTH passes stays a single PickLine, not two", () => {
    // Case size 20. Lot has 45 units: Pass 1 takes 2 cases (40), leaving 5.
    // Need is 45, so Pass 2 needs 5 more, which is still sitting in this
    // exact same lot. Must merge into one line (40 case + 5 each = 45 qty),
    // not appear twice in r.lines.
    const stock = [lot(1, "A1", "B1", [2027, 1], 45, "2027-01-15")];
    const r = allocate({ sku: "SKU-CASE", need: 45, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].caseQty).toBe(40);
    expect(r.lines[0].eachQty).toBe(5);
    expect(r.lines[0].qty).toBe(45);
  });

  it("short: case supply plus each supply together still can't cover demand", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 50, "2027-01-15")]; // caseSize 20 -> 2 cases (40) + 10 eaches available = 50 max
    const r = allocate({ sku: "SKU-CASE", need: 70, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines[0].caseQty).toBe(40);
    expect(r.lines[0].eachQty).toBe(10);
    expect(r.short).toBe(20);
  });

  it("respects the shelf-life cutoff exactly as before — case-based picking never makes an ineligible lot pickable", () => {
    // Lot is 8 months out; cutoff requires 12. Must be excluded entirely,
    // same as plain FEFO would exclude it, regardless of case size.
    const stock = [lot(1, "A1", "B1", [2027, 5], 500, "2027-05-15")]; // ~8 months from TODAY (2026-09-17)
    const r = allocate({ sku: "SKU-CASE", need: 100, cutoff: 12, stock, reservedFor: noReserve, today: TODAY, caseSize: 20 });
    expect(r.lines).toHaveLength(0);
    expect(r.short).toBe(100);
  });

  it("respects minQty (channel's minimum bin quantity floor) exactly as before", () => {
    const stock = [lot(1, "A1", "B1", [2027, 1], 15, "2027-01-15")]; // below a 20-unit floor
    const r = allocate({ sku: "SKU-CASE", need: 15, cutoff: 0, stock, reservedFor: noReserve, today: TODAY, caseSize: 5, minQty: 20 });
    expect(r.lines).toHaveLength(0);
    expect(r.short).toBe(15);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].bin).toBe("A1");
  });
});
