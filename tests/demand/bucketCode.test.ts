import { describe, expect, it } from "vitest";
import { bucketCode } from "../../src/lib/channels";

describe("bucketCode", () => {
  it("uses the built-in bucket for a known channel", () => {
    expect(bucketCode("Amazon")).toBe("B2BE");
  });

  it("falls back to GEN for an unknown channel with no custom mapping", () => {
    expect(bucketCode("Some New Channel")).toBe("GEN");
  });

  it("uses an Admin-added channel's custom bucket instead of falling back to GEN", () => {
    expect(bucketCode("Croma", { Croma: "B2B Offline" })).toBe("B2BO");
  });

  it("prefers the custom mapping even if the name happens to collide with a built-in one", () => {
    expect(bucketCode("Amazon", { Amazon: "Replenishment" })).toBe("REPL");
  });
});
