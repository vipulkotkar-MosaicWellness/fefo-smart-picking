// tests/components/GatepassAdherenceMetric2Window.test.tsx
// Separate file because it needs its own file-wide vi.mock fixtures (20
// days of case-based-era data), which would otherwise risk conflicting with
// tests/components/GatepassAdherenceRestructure.test.tsx's own file-wide
// mocks of the same two modules.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gatepassAdherenceSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gatepassAdherenceSupabase")>();
  // 20 case-based-era days (2026-09-17 through 2026-10-06) — more than the
  // 15-day window the top section's chart/table show, so a subtitle
  // computed from ALL case-based rows instead of just the trailing 15
  // would visibly diverge from one computed correctly.
  const days = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 17 + i));
    const reportDate = d.toISOString().slice(0, 10);
    return { gatepass_code: `GP-DAY-${i}`, facility: "SL Mother Hub", report_date: reportDate, instructed_qty: 10, compliant_qty: 10, adherence_pct: 100, lines: [] };
  });
  return { ...actual, fetchGatepassAdherence: vi.fn(async () => days) };
});

vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return {
    ...actual,
    // A deviation on day 0 (GP-DAY-0, outside the trailing-15-day window
    // once 20 days exist) must NOT be counted in the subtitle. A deviation
    // on the last day (inside the window) must be.
    fetchFefoDeviations: vi.fn(async () => [
      { gate_pass_no: "GP-DAY-0", facility: "SL Mother Hub", sku: "SKU-OLD", bin: "A1", batch: "B1", deviation_qty: 999, created_at: "2026-09-17T00:00:00.000Z" },
      { gate_pass_no: "GP-DAY-19", facility: "SL Mother Hub", sku: "SKU-NEW", bin: "A2", batch: "B2", deviation_qty: 3, created_at: "2026-10-06T00:00:00.000Z" },
    ]),
  };
});

describe("GatepassAdherence — Metric 2 subtitle window", () => {
  it("the breach-units subtitle reflects only the trailing 15 days shown in the chart/table, not every case-based-era row ever logged", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    // Only the in-window deviation (3 units) should ever appear in the
    // subtitle text — the out-of-window 999 must never leak in, whether
    // alone or summed (e.g. "1002").
    expect(await screen.findByText(/3 units breached FEFO/i)).toBeInTheDocument();
    expect(screen.queryByText(/999 units breached FEFO/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,002 units breached FEFO/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1002 units breached FEFO/i)).not.toBeInTheDocument();
  });
});
