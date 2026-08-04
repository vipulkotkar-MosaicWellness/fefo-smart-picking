import { describe, expect, it } from "vitest";
import { inRange, rangeFor } from "../../src/lib/dateRanges";

const now = new Date(2026, 7, 15, 14, 30, 0); // 15 Aug 2026, 14:30 local time

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("rangeFor", () => {
  it("today spans midnight to now", () => {
    const { start, end } = rangeFor("today", now);
    expect(ymd(start)).toBe("2026-08-15");
    expect(start.getHours()).toBe(0);
    expect(end).toEqual(now);
  });

  it("yesterday spans the full previous calendar day only", () => {
    const { start, end } = rangeFor("yesterday", now);
    expect(ymd(start)).toBe("2026-08-14");
    expect(ymd(end)).toBe("2026-08-15");
    expect(end.getHours()).toBe(0);
  });

  it("last 7 days includes today and goes back 7 full days", () => {
    const { start, end } = rangeFor("last7", now);
    expect(ymd(start)).toBe("2026-08-08");
    expect(end).toEqual(now);
  });

  it("last 30 days goes back 30 full days", () => {
    const { start, end } = rangeFor("last30", now);
    expect(ymd(start)).toBe("2026-07-16");
    expect(end).toEqual(now);
  });
});

describe("inRange", () => {
  it("includes a timestamp within [start, end)", () => {
    const { start, end } = rangeFor("today", now);
    expect(inRange(new Date(2026, 7, 15, 9, 0).toISOString(), start, end)).toBe(true);
  });

  it("excludes a timestamp before start", () => {
    const { start, end } = rangeFor("today", now);
    expect(inRange(new Date(2026, 7, 14, 23, 59).toISOString(), start, end)).toBe(false);
  });

  it("excludes a timestamp at or after end", () => {
    const { start, end } = rangeFor("today", now);
    expect(inRange(now.toISOString(), start, end)).toBe(false);
  });
});
