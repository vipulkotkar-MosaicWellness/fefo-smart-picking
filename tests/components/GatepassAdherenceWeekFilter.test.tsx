// tests/components/GatepassAdherenceWeekFilter.test.tsx
// Separate file because it needs a 6-week fixture (more than any other
// GatepassAdherence test file uses) to prove the "Last N weeks" filter
// genuinely narrows the row set, not just that the UI accepts a selection.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gatepassAdherenceSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/gatepassAdherenceSupabase")>();
  const weeks = ["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"];
  const rows = weeks.map((date, i) => ({
    gatepass_code: `GP-EXTRA-${i}`,
    facility: "SL Mother Hub",
    report_date: date,
    instructed_qty: 100,
    compliant_qty: 90,
    adherence_pct: 90,
    lines: [],
  }));
  return { ...actual, fetchGatepassAdherence: vi.fn(async () => rows) };
});

vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return { ...actual, fetchFefoDeviations: vi.fn(async () => []) };
});

describe("GatepassAdherence — 'Last N weeks' filter with more weeks than the window", () => {
  it("filtering to fewer weeks than exist actually drops the older rows", async () => {
    const user = userEvent.setup();
    const { GatepassAdherence } = await import("../../src/components/GatepassAdherence");
    render(<GatepassAdherence />);

    await screen.findByText(/Showing 6 of 6 weeks/, {}, { timeout: 3000 });
    const table = screen.getByRole("table");

    const filterSelects = screen.getAllByLabelText(/Weeks to show/i);
    await user.selectOptions(filterSelects[0], "4");

    expect(await screen.findByText(/Showing 4 of 6 weeks/)).toBeInTheDocument();
    // The two oldest weeks are the ones dropped by "Last 4 weeks" — scoped
    // to the TABLE specifically, since the chart card's "Best Week" tile
    // legitimately keeps showing the true all-time best week (2026-07-27,
    // the earliest of several tied-at-90% weeks) regardless of this
    // display-only filter, and would otherwise collide with a page-wide
    // text query for that same date.
    expect(within(table).queryByText("2026-07-27")).not.toBeInTheDocument();
    expect(within(table).queryByText("2026-08-03")).not.toBeInTheDocument();
    expect(within(table).getByText("2026-08-31")).toBeInTheDocument();
  });
});
