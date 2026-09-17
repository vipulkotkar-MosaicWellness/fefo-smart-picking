// tests/components/GatepassAdherenceRestructure.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gatepassAdherenceSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gatepassAdherenceSupabase")>();
  return {
    ...actual,
    fetchGatepassAdherence: vi.fn(async () => [
      // Pure-FEFO baseline (before launch)
      { gatepass_code: "GP-OLD-1", facility: "SL Mother Hub", report_date: "2026-08-20", instructed_qty: 100, compliant_qty: 80, adherence_pct: 80, lines: [] },
      // Case-based era (on/after launch)
      { gatepass_code: "GP-NEW-1", facility: "SL Mother Hub", report_date: "2026-09-17", instructed_qty: 100, compliant_qty: 95, adherence_pct: 95, lines: [] },
    ]),
  };
});

vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return {
    ...actual,
    fetchFefoDeviations: vi.fn(async () => [
      { gate_pass_no: "GP-NEW-1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" },
    ]),
  };
});

describe("GatepassAdherence — restructured screen", () => {
  it("shows Metric 1 and Metric 2 for the case-based era, and the pure-FEFO baseline separately below", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    // "Pure case-based" appears both in the card heading and the table's own
    // column header — findAllByText, not findByText, since both are real and
    // expected, not a duplicate-render bug.
    expect((await screen.findAllByText(/Pure case-based/i)).length).toBeGreaterThan(0);
    // "95%" appears in both the chart's value label and the new table's Tag
    // cell for this metric — getAllByText, not getByText, since both are
    // real and expected, not a duplicate-render bug.
    expect((await screen.findAllByText(/95%/)).length).toBeGreaterThan(0); // Metric 1

    expect((await screen.findAllByText(/FEFO breach/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/85%/)).length).toBeGreaterThan(0); // Metric 2: 95 - 10 = 85

    // The pure-FEFO baseline section still shows the old 80% day, kept separate.
    expect((await screen.findAllByText(/80%/)).length).toBeGreaterThan(0);
  });
});
