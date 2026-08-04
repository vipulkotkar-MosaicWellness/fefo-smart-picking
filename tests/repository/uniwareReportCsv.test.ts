import { describe, expect, it } from "vitest";
import { uniwareReportCsv } from "../../src/lib/uniwareExport";
import type { FacilityPicklist } from "../../src/lib/types";

function line(overrides: Partial<FacilityPicklist["lines"][number]> = {}) {
  return { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

describe("uniwareReportCsv", () => {
  it("has a trailing Primary Picklist column in the header", () => {
    const csv = uniwareReportCsv([]);
    expect(csv.split("\n")[0]).toBe("Item Sku Code*,Qty,Inventory Type,Shelf Code,Unit Price,Uniware Batch Code,Force Allocate,Primary Picklist");
  });

  it("leaves the Primary Picklist column blank for an ordinary (round 1) picklist", () => {
    const csv = uniwareReportCsv([{ no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, lines: [line()] }]);
    const row = csv.split("\n")[1];
    expect(row.endsWith(",")).toBe(true); // last field is empty
  });

  it("fills the Primary Picklist column with the original facility number for an alternate (round 2+)", () => {
    const csv = uniwareReportCsv([{ no: "TASK-1-MH-R2", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 2, bad: 0, lines: [line()] }]);
    const row = csv.split("\n")[1];
    expect(row.endsWith(",TASK-1-MH")).toBe(true);
  });
});
