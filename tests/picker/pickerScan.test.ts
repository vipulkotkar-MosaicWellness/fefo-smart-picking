import { describe, expect, it } from "vitest";
import { scanMatches } from "../../src/lib/pickerScan";

describe("scanMatches", () => {
  it("matches the expected batch code exactly", () => {
    expect(scanMatches("BA019232", "BA019232")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(scanMatches(" ba019232 ", "BA019232")).toBe(true);
  });

  it("rejects a different batch code", () => {
    expect(scanMatches("WRONG-BATCH", "BA019232")).toBe(false);
  });

  it("rejects an empty scan", () => {
    expect(scanMatches("", "BA019232")).toBe(false);
  });
});
