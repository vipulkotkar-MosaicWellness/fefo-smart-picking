import { describe, expect, it } from "vitest";
import { gatePassBulkCsv } from "../../src/lib/uniwareExport";
import type { PickLine } from "../../src/lib/types";

function line(overrides: Partial<PickLine> = {}): PickLine {
  return { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, ...overrides };
}

describe("gatePassBulkCsv", () => {
  it("has the exact Gate Pass ID, SKU, Qty header", () => {
    expect(gatePassBulkCsv([]).split("\n")[0]).toBe("Gate Pass ID,SKU,Qty");
  });

  it("emits one row per line, tagged with its gate pass number", () => {
    const csv = gatePassBulkCsv([
      { gatePassNo: "GP-1001", lines: [line({ sku: "SKU-A", qty: 5 }), line({ sku: "SKU-B", qty: 3 })] },
      { gatePassNo: "GP-1002", lines: [line({ sku: "SKU-A", qty: 9 })] },
    ]);
    const rows = csv.trim().split("\n").slice(1);
    expect(rows).toEqual(["GP-1001,SKU-A,5", "GP-1001,SKU-B,3", "GP-1002,SKU-A,9"]);
  });
});
