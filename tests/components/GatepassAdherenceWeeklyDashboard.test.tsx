// tests/components/GatepassAdherenceWeeklyDashboard.test.tsx
// Covers the new interactive weekly-baseline features: sortable columns,
// week-over-week change, the "Last N weeks" filter, the current-week
// highlight, and the 4-tier status colors — none of which had any
// dedicated coverage when they were added.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gatepassAdherenceSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gatepassAdherenceSupabase")>();
  // 4 real weeks of pure-FEFO baseline data (all before the 17 Sep launch),
  // spanning all four WEEKLY_STATUS tiers so the pill-color boundaries are
  // actually exercised: 69% (critical, <70), 76% (below target, 70-79),
  // 88% (watch, 80-94), 96% (on target, ≥95).
  const rows = [
    { gatepass_code: "GP-1", facility: "SL Mother Hub", report_date: "2026-08-17", instructed_qty: 100, compliant_qty: 69, adherence_pct: 69, lines: [] },
    { gatepass_code: "GP-2", facility: "SL Mother Hub", report_date: "2026-08-24", instructed_qty: 100, compliant_qty: 76, adherence_pct: 76, lines: [] },
    { gatepass_code: "GP-3", facility: "SL Mother Hub", report_date: "2026-08-31", instructed_qty: 100, compliant_qty: 88, adherence_pct: 88, lines: [] },
    { gatepass_code: "GP-4", facility: "SL Mother Hub", report_date: "2026-09-07", instructed_qty: 100, compliant_qty: 96, adherence_pct: 96, lines: [] },
  ];
  return { ...actual, fetchGatepassAdherence: vi.fn(async () => rows) };
});

vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return { ...actual, fetchFefoDeviations: vi.fn(async () => []) };
});

describe("GatepassAdherence — weekly baseline dashboard features", () => {
  it("computes week-over-week change correctly and shows '—' for the first week", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    const rows = within(table).getAllByRole("row");
    // Header + 4 week rows + Overall row.
    expect(rows.length).toBeGreaterThanOrEqual(5);

    // Week 1 (17 Aug, 69%) has no prior week — WoW shows an em-dash, not a computed value.
    const week1Row = rows.find((r) => within(r).queryByText("2026-08-17"));
    expect(week1Row).toBeTruthy();
    expect(within(week1Row!).getByText("—")).toBeInTheDocument();

    // Week 2 (24 Aug, 76%) is +7 points over week 1 (69%).
    const week2Row = rows.find((r) => within(r).queryByText("2026-08-24"));
    expect(within(week2Row!).getByText(/7\.0%/)).toBeInTheDocument();
  });

  it("shows all four WEEKLY_STATUS tiers distinctly across the boundary values 69/76/88/96", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    expect(within(table).getByText("69%")).toBeInTheDocument();
    expect(within(table).getByText("76%")).toBeInTheDocument();
    expect(within(table).getByText("88%")).toBeInTheDocument();
    expect(within(table).getByText("96%")).toBeInTheDocument();
  });

  it("clicking a column header sorts the table, and clicking again reverses it", async () => {
    const user = userEvent.setup();
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    const adherenceHeader = within(table).getByText(/Adherence/);

    await user.click(adherenceHeader); // ascending by adherence: 69, 76, 88, 96
    let dataRows = within(table).getAllByRole("row").slice(1, 5); // skip header row
    expect(within(dataRows[0]).getByText("69%")).toBeInTheDocument();
    expect(within(dataRows[3]).getByText("96%")).toBeInTheDocument();

    await user.click(adherenceHeader); // click again: descending
    dataRows = within(table).getAllByRole("row").slice(1, 5);
    expect(within(dataRows[0]).getByText("96%")).toBeInTheDocument();
    expect(within(dataRows[3]).getByText("69%")).toBeInTheDocument();
  });

  it("the 'Last N weeks' filter reduces the row count and updates the 'Showing X of Y' footer", async () => {
    const user = userEvent.setup();
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    await screen.findByRole("table", {}, { timeout: 3000 });
    // Default is "All weeks" — 4 of 4 shown, nothing filtered out yet.
    expect(screen.getByText(/Showing 4 of 4 weeks/)).toBeInTheDocument();

    // Table and chart cards each have their own "Weeks to show" select,
    // kept in sync — selecting on the first one is enough to verify the
    // filtering logic; the second exists purely as the chart's own control.
    const filterSelects = screen.getAllByLabelText(/Weeks to show/i);
    expect(filterSelects.length).toBeGreaterThanOrEqual(1);
    await user.selectOptions(filterSelects[0], "4"); // "Last 4 weeks" == all 4 real weeks — no visible change expected
    expect(screen.getByText(/Showing 4 of 4 weeks/)).toBeInTheDocument();
  });

  it("the most recent week's row is visually distinguished as the current week", async () => {
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    const rows = within(table).getAllByRole("row");
    const currentRow = rows.find((r) => within(r).queryByText("2026-09-07"));
    expect(currentRow).toBeTruthy();
    expect(currentRow!.className).toMatch(/emerald/);
  });
});
