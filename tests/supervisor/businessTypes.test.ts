import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_UNMAPPED, BUSINESS_TYPES, businessTypeOf } from "../../src/lib/businessTypes";

describe("businessTypeOf", () => {
  it("maps a known channel to its business type", () => {
    expect(businessTypeOf("Amazon")).toBe("B2B Ecommerce + Q- Commerce");
  });

  it("maps a replenishment channel correctly", () => {
    expect(businessTypeOf("STN - MM")).toBe("Internal Stock Transfer - Warehouse - 3PL");
  });

  it("returns the unmapped marker for a channel not in the table", () => {
    expect(businessTypeOf("Some Brand New Channel Nobody Has Heard Of")).toBe(BUSINESS_TYPE_UNMAPPED);
  });
});

describe("BUSINESS_TYPES", () => {
  it("includes the unmapped marker as a selectable option", () => {
    expect(BUSINESS_TYPES).toContain(BUSINESS_TYPE_UNMAPPED);
  });
});
