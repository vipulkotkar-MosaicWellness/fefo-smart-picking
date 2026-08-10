import { describe, expect, it } from "vitest";
import { parseShelfwiseCsv } from "../../src/lib/shelfwiseCsv";

const HEADER =
  "Facility,Item Type SKU Code,Item Type Name,Inventory Type,Shelf,Quantity,Batch Code,Expiry,Manufacturing,Batch Status";

function row(fields: Record<string, string>): string {
  const order = ["Facility", "SKU", "Name", "InvType", "Shelf", "Qty", "Batch", "Expiry", "Mfg", "Status"];
  const map: Record<string, string> = {
    Facility: fields.facility ?? "SL Mother Hub",
    SKU: fields.sku ?? "SKU-1",
    Name: fields.name ?? "Product 1",
    InvType: fields.invType ?? "GOOD_INVENTORY",
    Shelf: fields.bin ?? "A1",
    Qty: fields.qty ?? "10",
    Batch: fields.batch ?? "B1",
    Expiry: fields.expiry ?? "2028-01-01",
    Mfg: fields.mfg ?? "2026-01-01",
    Status: fields.status ?? "Active",
  };
  return order.map((k) => map[k]).join(",");
}

describe("parseShelfwiseCsv", () => {
  it("parses a well-formed row into a usable stock row", () => {
    const csv = HEADER + "\n" + row({});
    const result = parseShelfwiseCsv(csv);
    expect(result.rows).toEqual([
      { facility: "SL Mother Hub", bin: "A1", sku: "SKU-1", name: "Product 1", batch: "B1", expiry: "2028-01-01", qty: 10, shelf: 24 },
    ]);
  });

  it("computes shelf life in months from manufacturing to expiry", () => {
    const csv = HEADER + "\n" + row({ mfg: "2026-01-01", expiry: "2027-07-01" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows[0].shelf).toBe(18);
  });

  it("falls back to 24 months when manufacturing/expiry dates are unusable", () => {
    const csv = HEADER + "\n" + row({ mfg: "not-a-date", expiry: "also-not-a-date" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows[0].shelf).toBe(24);
  });

  it("drops a row for a facility outside the 3 target facilities", () => {
    const csv = HEADER + "\n" + row({ facility: "Some Other Warehouse" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.dropped.facility).toBe(1);
  });

  it("drops a row that isn't GOOD_INVENTORY", () => {
    const csv = HEADER + "\n" + row({ invType: "BAD_INVENTORY" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.dropped.invType).toBe(1);
  });

  it("drops a row whose batch status isn't Active", () => {
    const csv = HEADER + "\n" + row({ status: "Inactive" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.dropped.status).toBe(1);
  });

  it("drops a row with zero or missing quantity", () => {
    const csv = HEADER + "\n" + row({ qty: "0" });
    const result = parseShelfwiseCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.dropped.qtyZero).toBe(1);
  });

  it("keeps good rows and drops bad ones in the same file, tallying each reason", () => {
    const csv = [
      HEADER,
      row({ sku: "KEEP-1" }),
      row({ sku: "DROP-FACILITY", facility: "Nowhere" }),
      row({ sku: "DROP-TYPE", invType: "BAD_INVENTORY" }),
      row({ sku: "KEEP-2", batch: "B2" }),
    ].join("\n");
    const result = parseShelfwiseCsv(csv);
    expect(result.rows.map((r) => r.sku)).toEqual(["KEEP-1", "KEEP-2"]);
    expect(result.dropped.facility).toBe(1);
    expect(result.dropped.invType).toBe(1);
    expect(result.totalRows).toBe(4);
  });

  it("handles a quoted field containing a comma", () => {
    const csv = HEADER + "\n" + `SL Mother Hub,SKU-1,"Product, with a comma",GOOD_INVENTORY,A1,10,B1,2028-01-01,2026-01-01,Active`;
    const result = parseShelfwiseCsv(csv);
    expect(result.rows[0].name).toBe("Product, with a comma");
  });

  it("throws a clear error when a required column is missing from the header", () => {
    const badHeader = "Facility,Item Type SKU Code,Item Type Name"; // missing the rest
    const csv = badHeader + "\nSL Mother Hub,SKU-1,Product 1";
    expect(() => parseShelfwiseCsv(csv)).toThrow(/Inventory Type/);
  });

  it("returns no rows for an empty file (header only)", () => {
    const result = parseShelfwiseCsv(HEADER);
    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
  });
});
