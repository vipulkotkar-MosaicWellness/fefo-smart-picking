import { describe, expect, it } from "vitest";
import { ageDays, ageingRangeFor, inAgeingRange } from "../../src/lib/ageing";

const now = new Date(2026, 7, 15, 14, 30, 0); // 15 Aug 2026, 14:30 local time

describe("ageingRangeFor", () => {
  it("today spans midnight to now", () => {
    const r = ageingRangeFor("today", now);
    expect(r.start.getDate()).toBe(15);
    expect(r.start.getHours()).toBe(0);
    expect(r.end).toEqual(now);
  });

  it("yesterday spans the full previous calendar day only", () => {
    const r = ageingRangeFor("yesterday", now);
    expect(r.start.getDate()).toBe(14);
    expect(r.end.getDate()).toBe(15);
    expect(r.end.getHours()).toBe(0);
  });

  it("last7 goes back 7 full days from today's midnight", () => {
    const r = ageingRangeFor("last7", now);
    expect(r.start.getDate()).toBe(8);
    expect(r.end).toEqual(now);
  });

  it("last30 goes back 30 full days from today's midnight", () => {
    const r = ageingRangeFor("last30", now);
    expect(r.start.getMonth()).toBe(6); // July
    expect(r.start.getDate()).toBe(16);
  });

  it("custom uses the given from/to dates, inclusive of the whole 'to' day", () => {
    const r = ageingRangeFor("custom", now, { from: "2026-08-01", to: "2026-08-03" });
    expect(r.start.toISOString().slice(0, 10)).toBe("2026-08-01");
    // end is exclusive in inAgeingRange, so it must land on the 4th to include all of the 3rd
    expect(r.end.toISOString().slice(0, 10)).toBe("2026-08-04");
  });
});

describe("inAgeingRange", () => {
  it("includes a timestamp within [start, end)", () => {
    const r = ageingRangeFor("today", now);
    expect(inAgeingRange(new Date(2026, 7, 15, 9, 0).toISOString(), r)).toBe(true);
  });

  it("excludes a timestamp before start", () => {
    const r = ageingRangeFor("today", now);
    expect(inAgeingRange(new Date(2026, 7, 14, 23, 59).toISOString(), r)).toBe(false);
  });
});

describe("ageDays", () => {
  it("returns 0 for something from earlier today", () => {
    expect(ageDays(new Date(2026, 7, 15, 9, 0).toISOString(), now)).toBe(0);
  });

  it("returns the whole number of days elapsed", () => {
    expect(ageDays(new Date(2026, 7, 10, 14, 30).toISOString(), now)).toBe(5);
  });

  it("never returns negative for a future timestamp", () => {
    expect(ageDays(new Date(2026, 7, 20).toISOString(), now)).toBe(0);
  });
});
