import { describe, expect, it } from "vitest";
import { bucketFor } from "../../src/lib/dateRanges";

const now = new Date(2026, 7, 15, 14, 30, 0); // 15 Aug 2026, 14:30 local time

describe("bucketFor", () => {
  it("puts a timestamp from earlier today in 'today'", () => {
    expect(bucketFor(new Date(2026, 7, 15, 9, 0).toISOString(), now)).toBe("today");
  });

  it("puts a timestamp from yesterday in 'yesterday', not 'today' or 'last7'", () => {
    expect(bucketFor(new Date(2026, 7, 14, 23, 59).toISOString(), now)).toBe("yesterday");
  });

  it("puts a 3-day-old timestamp in 'last7', not 'yesterday'", () => {
    expect(bucketFor(new Date(2026, 7, 12, 10, 0).toISOString(), now)).toBe("last7");
  });

  it("puts a 20-day-old timestamp in 'last30', not 'last7'", () => {
    expect(bucketFor(new Date(2026, 6, 26, 10, 0).toISOString(), now)).toBe("last30");
  });

  it("puts anything older than 30 days in 'older'", () => {
    expect(bucketFor(new Date(2026, 5, 1, 10, 0).toISOString(), now)).toBe("older");
  });

  it("never double-counts a timestamp across two buckets", () => {
    const timestamps = [
      new Date(2026, 7, 15, 0, 0),
      new Date(2026, 7, 14, 0, 0),
      new Date(2026, 7, 8, 0, 0),
      new Date(2026, 7, 7, 23, 59),
      new Date(2026, 6, 16, 0, 0),
      new Date(2026, 6, 15, 23, 59),
    ];
    const buckets = timestamps.map((d) => bucketFor(d.toISOString(), now));
    expect(new Set(buckets).size).toBeLessThanOrEqual(buckets.length);
    // last7's window starts exactly 7 days before today's midnight (Aug 8
    // 00:00) — Aug 7 23:59 falls just short of it, into last30.
    expect(buckets).toEqual(["today", "yesterday", "last7", "last30", "last30", "older"]);
  });
});
