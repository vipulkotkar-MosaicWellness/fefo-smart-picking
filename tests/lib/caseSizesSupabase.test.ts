// tests/lib/caseSizesSupabase.test.ts
import { describe, expect, it } from "vitest";
import { applyCaseSizeRows } from "../../src/lib/caseSizesSupabase";

describe("applyCaseSizeRows", () => {
  it("builds a sku -> case size map from rows", () => {
    const result = applyCaseSizeRows([
      { sku: "SKU-A", case_size: 30 },
      { sku: "SKU-B", case_size: 190 },
    ]);
    expect(result).toEqual({ "SKU-A": 30, "SKU-B": 190 });
  });

  it("a SKU with no row simply has no entry — not a 0 or a default", () => {
    const result = applyCaseSizeRows([{ sku: "SKU-A", case_size: 30 }]);
    expect(result["SKU-UNKNOWN"]).toBeUndefined();
  });

  it("ignores a case_size of 0 or 1 as effectively 'not set'", () => {
    const result = applyCaseSizeRows([
      { sku: "SKU-A", case_size: 0 },
      { sku: "SKU-B", case_size: 1 },
      { sku: "SKU-C", case_size: 12 },
    ]);
    expect(result).toEqual({ "SKU-C": 12 });
  });
});
