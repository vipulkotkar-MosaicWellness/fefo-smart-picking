// tests/components/FacilityBlockExportCaseColumn.test.ts
import { describe, expect, it } from "vitest";
import { buildShareRows } from "../../src/components/FacilityBlock";
import type { FacilityPicklist } from "../../src/lib/types";

describe("FacilityBlock share/export rows — case+each column", () => {
  it("includes case and each columns for a split line", () => {
    const f: FacilityPicklist = {
      no: "TASK-EXP-MH", taskNo: "TASK-EXP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
      lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200, caseQty: 180, eachQty: 20 }],
    };
    const rows = buildShareRows(f);
    expect(rows[0]).toMatchObject({ qty: 200, caseQty: 180, eachQty: 20 });
  });

  it("a plain line (no case size) has empty/undefined case and each columns", () => {
    const f: FacilityPicklist = {
      no: "TASK-EXP-MH", taskNo: "TASK-EXP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
      lines: [{ rid: 1, sku: "SKU-PLAIN", name: "Product Plain", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200 }],
    };
    const rows = buildShareRows(f);
    expect(rows[0].caseQty).toBeUndefined();
    expect(rows[0].eachQty).toBeUndefined();
  });
});
