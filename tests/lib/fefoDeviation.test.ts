// tests/lib/fefoDeviation.test.ts
import { describe, expect, it } from "vitest";
import { computeFefoDeviation } from "../../src/lib/fefoDeviation";
import type { PickLine } from "../../src/lib/types";

function line(overrides: Partial<PickLine>): PickLine {
  return { rid: 1, sku: "SKU-X", name: "Product X", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2027, 1], rem: 12, qty: 0, ...overrides };
}

describe("computeFefoDeviation", () => {
  it("the design doc's worked example: case-first takes 90 from a later lot + 10 eaches, strict FEFO would take 20 eaches + 80 from the later lot — deviation is 10 units, attributed to the later lot", () => {
    // Need 100, case size 30. Case-first: 3 cases (90) from the later-expiry
    // case-packed lot, 10 loose eaches from the earliest 20-unit bin.
    const caseBasedLines: PickLine[] = [
      line({ rid: 1, bin: "A1", batch: "CASE-LOT", qty: 90, caseQty: 90 }),
      line({ rid: 2, bin: "A5", batch: "EACHES-LOT", qty: 10, eachQty: 10 }),
    ];
    // Strict FEFO: all 20 from the earliest eaches bin first, then 80 from the case lot.
    const strictFefoLines: PickLine[] = [
      line({ rid: 2, bin: "A5", batch: "EACHES-LOT", qty: 20 }),
      line({ rid: 1, bin: "A1", batch: "CASE-LOT", qty: 80 }),
    ];

    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);

    expect(result).toEqual([{ sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviationQty: 10 }]);
  });

  it("no deviation when case-first and strict FEFO agree exactly (no case size configured)", () => {
    const lines: PickLine[] = [line({ rid: 1, bin: "A1", batch: "B1", qty: 50 })];
    const result = computeFefoDeviation(lines, lines);
    expect(result).toEqual([]);
  });

  it("sums quantities from the same lot appearing in multiple lines before diffing", () => {
    const caseBasedLines: PickLine[] = [
      line({ rid: 1, bin: "A1", batch: "B1", qty: 30, caseQty: 30 }),
      line({ rid: 2, bin: "A1", batch: "B1", qty: 10, eachQty: 10 }), // same lot, different rid — e.g. two passes touching it
    ];
    const strictFefoLines: PickLine[] = [line({ rid: 1, bin: "A1", batch: "B1", qty: 25 })];
    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);
    expect(result).toEqual([{ sku: "SKU-X", bin: "A1", batch: "B1", deviationQty: 15 }]);
  });

  it("a lot strict FEFO used but case-first didn't touch at all still isn't a deviation line (deviationQty would be negative, omitted)", () => {
    const caseBasedLines: PickLine[] = [line({ rid: 1, bin: "A9", batch: "LATER", qty: 100, caseQty: 100 })];
    const strictFefoLines: PickLine[] = [
      line({ rid: 2, bin: "A1", batch: "EARLIER", qty: 60 }),
      line({ rid: 1, bin: "A9", batch: "LATER", qty: 40 }),
    ];
    const result = computeFefoDeviation(caseBasedLines, strictFefoLines);
    // Only the lot case-first took MORE from is reported (60 extra on LATER);
    // the EARLIER lot (which case-first skipped) isn't case-first's own line
    // at all, so it can't appear in caseBasedLines to be diffed.
    expect(result).toEqual([{ sku: "SKU-X", bin: "A9", batch: "LATER", deviationQty: 60 }]);
  });
});
