// tests/components/GatepassAdherenceTrendline.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// TrendChart isn't exported today — this test drives adding `export` to it,
// the minimal change, not a restructure.
import { TrendChart } from "../../src/components/GatepassAdherence";

function day(date: string, pct: number) {
  return { date, gatepassCount: 1, instructedQty: 100, compliantQty: pct, pct, rows: [] };
}

describe("TrendChart — optional trendline overlay", () => {
  it("renders no polyline or point circles when showTrendline is omitted (existing bars-only behavior unchanged)", () => {
    const { container } = render(<TrendChart days={[day("2026-09-15", 80), day("2026-09-16", 90)]} selectedDate={null} onSelectDate={() => {}} />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("renders a connecting polyline and one dot per day when showTrendline is true", () => {
    const { container } = render(<TrendChart days={[day("2026-09-15", 80), day("2026-09-16", 90), day("2026-09-17", 85)]} selectedDate={null} onSelectDate={() => {}} showTrendline />);
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});
