import { describe, expect, it } from "vitest";
import { resolvePickLine } from "../../src/lib/store";
import type { PickLine } from "../../src/lib/types";

function line(overrides: Partial<PickLine> = {}): PickLine {
  return { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, ...overrides };
}

describe("resolvePickLine", () => {
  it("marks a fully found line as picked, with no reason recorded", () => {
    const out = resolvePickLine(line(), { 1: 0 });
    expect(out.picked).toBe(10);
    expect(out.nf).toBe(0);
    expect(out.nfReason).toBeUndefined();
  });

  it("records the not-found quantity and the picker's reason together", () => {
    const out = resolvePickLine(line(), { 1: 4 }, { 1: "Damaged stock" });
    expect(out.picked).toBe(6);
    expect(out.nf).toBe(4);
    expect(out.nfReason).toBe("Damaged stock");
  });

  it("never records a reason when nothing was actually short", () => {
    // Reason map has an entry, but the qty itself is 0 — reason shouldn't stick.
    const out = resolvePickLine(line(), { 1: 0 }, { 1: "Damaged stock" });
    expect(out.nfReason).toBeUndefined();
  });

  it("leaves a line already picked untouched, even if it's in this batch", () => {
    const already = line({ picked: 10, nf: 0 });
    const out = resolvePickLine(already, { 1: 5 }, { 1: "Batch not found" });
    expect(out).toBe(already);
  });

  it("leaves a line not present in this batch of results untouched", () => {
    const untouched = line({ rid: 2 });
    const out = resolvePickLine(untouched, { 1: 5 });
    expect(out).toBe(untouched);
  });
});
