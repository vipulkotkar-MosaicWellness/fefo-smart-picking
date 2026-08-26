import { describe, expect, it } from "vitest";
import { NOT_FOUND_REASONS } from "../../src/lib/notFoundReasons";

describe("NOT_FOUND_REASONS", () => {
  it("includes the new buckets: batch mismatch, damaged stock, and B2B sales return stock", () => {
    expect(NOT_FOUND_REASONS).toContain("Batch mismatch");
    expect(NOT_FOUND_REASONS).toContain("Damaged stock");
    expect(NOT_FOUND_REASONS).toContain("B2B sales return stock");
  });

  it("keeps the original reasons already in use, so past picks stay meaningful", () => {
    expect(NOT_FOUND_REASONS).toContain("Not enough stock");
    expect(NOT_FOUND_REASONS).toContain("Batch not found");
    expect(NOT_FOUND_REASONS).toContain("Location blocked");
    expect(NOT_FOUND_REASONS).toContain("Other");
  });

  it("has no duplicate reasons", () => {
    expect(new Set(NOT_FOUND_REASONS).size).toBe(NOT_FOUND_REASONS.length);
  });
});
