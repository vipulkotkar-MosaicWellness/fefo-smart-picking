import { describe, expect, it } from "vitest";
import { bucketFor } from "../../src/lib/dateRanges";

const now = new Date(2026, 7, 15, 14, 30, 0); // 15 Aug 2026, 14:30 local time

describe("bucketFor", () => {
  it("puts a timestamp from earlier today in 'today'", () => {
    expect(bucketFor(new Date(2026, 7, 15, 9, 0).toISOString(), now)).toBe("today");
  });

  it("puts a timestamp from yesterday in 'yesterday', not 'today' or 'last30'", () => {
    expect(bucketFor(new Date(2026, 7, 14, 23, 59).toISOString(), now)).toBe("yesterday");
  });

  it("puts a 3-day-old timestamp in 'last30', not 'yesterday'", () => {
    expect(bucketFor(new Date(2026, 7, 12, 10, 0).toISOString(), now)).toBe("last30");
  });

  it("puts a 20-day-old timestamp in 'last30' too", () => {
    expect(bucketFor(new Date(2026, 6, 26, 10, 0).toISOString(), now)).toBe("last30");
  });

  it("puts anything older than 30 days in 'older' (Above 30 days)", () => {
    expect(bucketFor(new Date(2026, 5, 1, 10, 0).toISOString(), now)).toBe("older");
  });

  it("never double-counts a timestamp across two buckets", () => {
    const timestamps = [
      new Date(2026, 7, 15, 0, 0),
      new Date(2026, 7, 14, 0, 0),
      new Date(2026, 7, 8, 0, 0),
      new Date(2026, 6, 16, 0, 0),
      new Date(2026, 6, 15, 23, 59),
    ];
    const buckets = timestamps.map((d) => bucketFor(d.toISOString(), now));
    expect(buckets).toEqual(["today", "yesterday", "last30", "last30", "older"]);
  });
});
