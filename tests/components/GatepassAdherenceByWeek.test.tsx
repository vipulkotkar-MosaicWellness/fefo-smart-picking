// tests/components/GatepassAdherenceByWeek.test.tsx
import { describe, expect, it } from "vitest";
import { byWeek } from "../../src/components/GatepassAdherence";
import type { GatepassAdherence as GatepassAdherenceRow } from "../../src/lib/gatepassAdherenceSupabase";

function row(reportDate: string, instructed: number, compliant: number): GatepassAdherenceRow {
  return { gatepass_code: `GP-${reportDate}`, facility: "SL Mother Hub", report_date: reportDate, instructed_qty: instructed, compliant_qty: compliant, adherence_pct: (compliant / instructed) * 100, lines: [] };
}

describe("byWeek", () => {
  it("groups rows into Mon-Sun weeks and sums instructed/compliant unit-weighted", () => {
    // 20-26 Aug 2026 is a Thu-Wed span starting mid-week; the real historical
    // window (confirmed live: earliest report_date 2026-08-20) starts on a
    // Thursday, so week 1 here is a partial week by design, not a bug.
    const rows = [row("2026-08-20", 100, 80), row("2026-08-21", 100, 90), row("2026-08-27", 200, 190)];
    const weeks = byWeek(rows);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].instructedQty).toBe(200);
    expect(weeks[0].compliantQty).toBe(170);
    expect(weeks[0].pct).toBe(85);
    expect(weeks[1].instructedQty).toBe(200);
  });

  it("sorts weeks chronologically", () => {
    const rows = [row("2026-09-03", 100, 100), row("2026-08-20", 100, 50)];
    const weeks = byWeek(rows);
    expect(weeks[0].date < weeks[1].date).toBe(true);
  });
});
