import { describe, expect, it } from "vitest";
import { gatePassBulkCsv, uniwareCsv } from "../../src/lib/uniwareExport";
import type { PickLine } from "../../src/lib/types";

const HEADER = "Gate Pass ID,Item Sku Code*,Qty,Inventory Type,Shelf Code,Unit Price,Uniware Batch Code,Force Allocate";

function line(overrides: Partial<PickLine> = {}): PickLine {
  return { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, ...overrides };
}

describe("uniwareCsv", () => {
  it("has the Gate Pass ID as the first column", () => {
    const csv = uniwareCsv([line({ sku: "SKU-A", qty: 5, bin: "A1", batch: "B1" })], "GP-1001");
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(HEADER);
    expect(row.startsWith("GP-1001,SKU-A,5,GOOD_INVENTORY,A1,")).toBe(true);
  });
});

describe("gatePassBulkCsv", () => {
  it("has the same 8-column header as uniwareCsv", () => {
    expect(gatePassBulkCsv([]).split("\n")[0]).toBe(HEADER);
  });

  it("emits one row per line, tagged with its gate pass number, in the same format as the single-picklist export", () => {
    const csv = gatePassBulkCsv([
      { gatePassNo: "GP-1001", lines: [line({ sku: "SKU-A", qty: 5 }), line({ sku: "SKU-B", qty: 3 })] },
      { gatePassNo: "GP-1002", lines: [line({ sku: "SKU-A", qty: 9 })] },
    ]);
    const rows = csv.trim().split("\n").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].startsWith("GP-1001,SKU-A,5,GOOD_INVENTORY,")).toBe(true);
    expect(rows[1].startsWith("GP-1001,SKU-B,3,GOOD_INVENTORY,")).toBe(true);
    expect(rows[2].startsWith("GP-1002,SKU-A,9,GOOD_INVENTORY,")).toBe(true);
  });
});
