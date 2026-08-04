import { describe, expect, it } from "vitest";
import { primaryFacilityNo } from "../../src/lib/format";

describe("primaryFacilityNo", () => {
  it("strips the -R2 (alternate) suffix to find the original facility picklist", () => {
    expect(primaryFacilityNo("B2BE-BLINKIT-260803-001-MH-R2")).toBe("B2BE-BLINKIT-260803-001-MH");
  });

  it("leaves a primary (non-alternate) facility number unchanged", () => {
    expect(primaryFacilityNo("B2BE-BLINKIT-260803-001-MH")).toBe("B2BE-BLINKIT-260803-001-MH");
  });
});
