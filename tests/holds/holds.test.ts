import { describe, expect, it } from "vitest";
import { activeHoldKeys, holdKey, holdsToCreate } from "../../src/lib/holds";
import type { Hold } from "../../src/lib/types";

function hold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: 1,
    sku: "SKU-1",
    facility: "SL Mother Hub",
    bin: "A1",
    batch: "B1",
    heldAt: "2026-08-08T10:00:00.000Z",
    heldBy: "Admin",
    ...overrides,
  };
}

describe("holdKey", () => {
  it("combines sku, facility, bin, and batch into one string", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).toBe("SKU-1::SL Mother Hub::A1::B1");
  });

  it("produces different keys for different batches of the same sku+bin", () => {
    expect(holdKey("SKU-1", "SL Mother Hub", "A1", "B1")).not.toBe(holdKey("SKU-1", "SL Mother Hub", "A1", "B2"));
  });
});

describe("activeHoldKeys", () => {
  it("includes a hold with no releasedAt", () => {
    const keys = activeHoldKeys([hold()]);
    expect(keys.has(holdKey("SKU-1", "SL Mother Hub", "A1", "B1"))).toBe(true);
  });

  it("excludes a hold that has been released", () => {
    const keys = activeHoldKeys([hold({ releasedAt: "2026-08-09T10:00:00.000Z", releasedBy: "Admin" })]);
    expect(keys.size).toBe(0);
  });
});

describe("holdsToCreate", () => {
  it("creates one hold request per not-found line", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 4, nfReason: "Damaged stock" }];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toEqual([{ sku: "SKU-1", facility: "SL Mother Hub", bin: "A1", batch: "B1", reason: "Damaged stock", sourceTaskNo: "PT-001" }]);
  });

  it("skips a line with no not-found quantity", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 0 }];
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set())).toEqual([]);
  });

  it("skips a combination that's already actively held", () => {
    const lines = [{ sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 }];
    const existing = new Set([holdKey("SKU-1", "SL Mother Hub", "A1", "B1")]);
    expect(holdsToCreate(lines, "SL Mother Hub", "PT-001", existing)).toEqual([]);
  });

  it("de-duplicates two not-found lines that share the same sku+bin+batch", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 3 },
    ];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toHaveLength(1);
  });

  it("keeps two different skus on the same bin as two separate hold requests", () => {
    const lines = [
      { sku: "SKU-1", bin: "A1", batch: "B1", nf: 2 },
      { sku: "SKU-2", bin: "A1", batch: "B9", nf: 5 },
    ];
    const out = holdsToCreate(lines, "SL Mother Hub", "PT-001", new Set());
    expect(out).toHaveLength(2);
  });
});
