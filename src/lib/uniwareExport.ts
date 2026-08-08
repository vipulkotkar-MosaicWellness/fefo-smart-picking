import { unitPrice } from "./cogs";
import type { PickLine } from "./types";

const HEADER = "Gate Pass ID,Item Sku Code*,Qty,Inventory Type,Shelf Code,Unit Price,Uniware Batch Code,Force Allocate";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function lineRow(gatePassNo: string, l: PickLine): string {
  const price = unitPrice(l.sku);
  return [
    csvCell(gatePassNo),
    csvCell(l.sku),
    csvCell(l.qty),
    "GOOD_INVENTORY",
    csvCell(l.bin),
    price != null ? price : "",
    csvCell(l.batch ?? ""),
    "Yes",
  ].join(",");
}

/**
 * Build the Uniware-import-ready CSV for one facility picklist's active
 * lines: Gate Pass ID, Item Sku Code, Qty, Inventory Type, Shelf Code, Unit
 * Price, Uniware Batch Code, Force Allocate.
 */
export function uniwareCsv(lines: PickLine[], gatePassNo: string): string {
  return HEADER + "\n" + lines.map((l) => lineRow(gatePassNo, l)).join("\n") + "\n";
}

/**
 * Same format as uniwareCsv, across many picklists (and gate passes) at
 * once — used by Picklist Repository's "Bulk Gate Pass CSV" download.
 */
export function gatePassBulkCsv(entries: { gatePassNo: string; lines: PickLine[] }[]): string {
  const rows = entries.flatMap(({ gatePassNo, lines }) => lines.map((l) => lineRow(gatePassNo, l)));
  return HEADER + "\n" + rows.join("\n") + "\n";
}
