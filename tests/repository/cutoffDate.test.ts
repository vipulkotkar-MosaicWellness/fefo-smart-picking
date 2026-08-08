import { describe, expect, it } from "vitest";
import { matchesCutoff } from "../../src/lib/dateRanges";

describe("matchesCutoff", () => {
  const cutoff = "2026-08-07"; // a plain date, no time component

  it("'before' includes anything up to end of the day before the cutoff", () => {
    expect(matchesCutoff("2026-08-06T23:59:59.000Z", cutoff, "before")).toBe(true);
    expect(matchesCutoff("2026-08-01T00:00:00.000Z", cutoff, "before")).toBe(true);
  });

  it("'before' excludes the cutoff day itself", () => {
    expect(matchesCutoff("2026-08-07T00:00:00.000Z", cutoff, "before")).toBe(false);
  });

  it("'after' includes the cutoff day itself, onward", () => {
    expect(matchesCutoff("2026-08-07T00:00:00.000Z", cutoff, "after")).toBe(true);
    expect(matchesCutoff("2026-08-09T12:00:00.000Z", cutoff, "after")).toBe(true);
  });

  it("'after' excludes anything before the cutoff day", () => {
    expect(matchesCutoff("2026-08-06T23:59:59.000Z", cutoff, "after")).toBe(false);
  });
});
