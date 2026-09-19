// src/lib/fefoPurityMetrics.ts
import type { GatepassAdherence } from "./gatepassAdherenceSupabase";
import type { FefoDeviationRow } from "./fefoDeviationsSupabase";

export interface PurityMetrics {
  /** Pure case-based % — today's existing compliance metric, unchanged method, just scoped to this window. */
  metric1Pct: number;
  /** Metric 1 minus FEFO-breach %, conservative (assume-disjoint) bound — see the design doc. */
  metric2Pct: number;
  instructedQty: number;
  /** Total FEFO-deviation units counted in this window. */
  breachQty: number;
  /** Total units that failed the existing compliance check. */
  complianceMissQty: number;
}

/**
 * Metric 1 needs no join — it's exactly the existing adherence calculation
 * on whichever rows the caller passes in. Metric 2 joins deviation rows
 * against those SAME rows by gate pass number, so a deviation logged for a
 * gate pass outside this window (not yet reconciled, or from a different
 * date range) is correctly excluded rather than silently counted. When a
 * gate pass has both compliance-miss units and deviation units, we can't
 * tell — without unit serials, which no WMS tracks — whether they're the
 * same physical units, so both counts are subtracted independently (the
 * conservative, worst-case bound) rather than assuming overlap. Full
 * rationale and the worked numeric example this test file's fixtures come
 * from: docs/superpowers/specs/2026-09-17-fefo-purity-reporting-design.md.
 */
export function computePurityMetrics(adherenceRows: GatepassAdherence[], deviationRows: FefoDeviationRow[]): PurityMetrics {
  const instructedQty = adherenceRows.reduce((s, r) => s + r.instructed_qty, 0);
  const compliantQty = adherenceRows.reduce((s, r) => s + r.compliant_qty, 0);
  const complianceMissQty = instructedQty - compliantQty;
  const metric1Pct = instructedQty ? Math.round((compliantQty / instructedQty) * 10000) / 100 : 0;

  const gatePassesInWindow = new Set(adherenceRows.map((r) => r.gatepass_code));
  const breachQty = deviationRows
    .filter((d) => d.gate_pass_no && gatePassesInWindow.has(d.gate_pass_no))
    .reduce((s, d) => s + d.deviation_qty, 0);

  const badQty = complianceMissQty + breachQty;
  const metric2Pct = instructedQty ? Math.round(((instructedQty - badQty) / instructedQty) * 10000) / 100 : 0;

  return { metric1Pct, metric2Pct, instructedQty, breachQty, complianceMissQty };
}
