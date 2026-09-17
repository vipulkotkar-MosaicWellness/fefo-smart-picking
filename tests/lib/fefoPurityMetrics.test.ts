// tests/lib/fefoPurityMetrics.test.ts
import { describe, expect, it } from "vitest";
import { computePurityMetrics } from "../../src/lib/fefoPurityMetrics";
import type { GatepassAdherence } from "../../src/lib/gatepassAdherenceSupabase";
import type { FefoDeviationRow } from "../../src/lib/fefoDeviationsSupabase";

function adherenceRow(overrides: Partial<GatepassAdherence>): GatepassAdherence {
  return {
    gatepass_code: "GP-1", facility: "SL Mother Hub", report_date: "2026-09-17",
    instructed_qty: 100, compliant_qty: 100, adherence_pct: 100, lines: [],
    ...overrides,
  };
}

describe("computePurityMetrics", () => {
  it("the design doc's worked example: 95% compliance, 10-unit breach, conservative combine -> 85%", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 95, adherence_pct: 95 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" },
    ];

    const result = computePurityMetrics(adherenceRows, deviationRows);

    expect(result.metric1Pct).toBe(95);
    expect(result.breachQty).toBe(10);
    expect(result.complianceMissQty).toBe(5);
    expect(result.metric2Pct).toBe(85);
  });

  it("Metric 2 equals Metric 1 when there's no deviation data at all for the window", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ instructed_qty: 200, compliant_qty: 190, adherence_pct: 95 })];
    const result = computePurityMetrics(adherenceRows, []);
    expect(result.metric1Pct).toBe(95);
    expect(result.breachQty).toBe(0);
    expect(result.metric2Pct).toBe(95);
  });

  it("ignores a deviation row whose gate pass isn't in this window's adherence rows at all", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      // GP-2 was never reconciled in this window (still pending, or outside the date range) — must not count.
      { gate_pass_no: "GP-2", facility: "SL Mother Hub", sku: "SKU-Y", bin: "A1", batch: "B1", deviation_qty: 50, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(0);
    expect(result.metric2Pct).toBe(100);
  });

  it("ignores a deviation row with no gate pass number yet (still Gate Pass Allocation Pending)", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: null, facility: "SL Mother Hub", sku: "SKU-Y", bin: "A1", batch: "B1", deviation_qty: 20, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(0);
  });

  it("sums breach across multiple deviation rows for the same gate pass", () => {
    const adherenceRows: GatepassAdherence[] = [adherenceRow({ gatepass_code: "GP-1", instructed_qty: 100, compliant_qty: 100, adherence_pct: 100 })];
    const deviationRows: FefoDeviationRow[] = [
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 6, created_at: "2026-09-17T00:00:00.000Z" },
      { gate_pass_no: "GP-1", facility: "SL Mother Hub", sku: "SKU-Y", bin: "A2", batch: "B2", deviation_qty: 4, created_at: "2026-09-17T00:00:00.000Z" },
    ];
    const result = computePurityMetrics(adherenceRows, deviationRows);
    expect(result.breachQty).toBe(10);
  });

  it("returns 0% for both metrics when instructedQty is 0, not NaN or a divide-by-zero error", () => {
    const result = computePurityMetrics([], []);
    expect(result.metric1Pct).toBe(0);
    expect(result.metric2Pct).toBe(0);
  });
});
