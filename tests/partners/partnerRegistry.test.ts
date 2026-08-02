import { describe, expect, it } from "vitest";
import { getPartnerMark } from "../../src/lib/partners";

describe("getPartnerMark", () => {
  it("falls back to two-letter initials from a single word", () => {
    expect(getPartnerMark({ name: "Blinkit", logoPath: null, logoApproved: false }).fallback).toBe("BL");
  });

  it("falls back to first-letter-of-each-word initials for multi-word names", () => {
    expect(getPartnerMark({ name: "TATA 1MG", logoPath: null, logoApproved: false }).fallback).toBe("T1");
  });

  it("never returns a logo unless it is locally stored and approved", () => {
    expect(getPartnerMark({ name: "New Partner", logoPath: "/partners/new.png", logoApproved: false }).logoUrl).toBeNull();
    expect(getPartnerMark({ name: "New Partner", logoPath: "/partners/new.png", logoApproved: true }).logoUrl).toBe(
      "/partners/new.png",
    );
  });

  it("always keeps the canonical partner name available", () => {
    expect(getPartnerMark({ name: "Wellness Forever", logoPath: null, logoApproved: false }).name).toBe("Wellness Forever");
  });
});
