import { unitPrice } from "./cogs";
import type { PickLine } from "./types";

const HEADER = "Item Sku Code*,Qty,Inventory Type,Shelf Code,Unit Price,Uniware Batch Code,Force Allocate";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the Uniware-import-ready CSV for one facility picklist's active lines. */
export function uniwareCsv(lines: PickLine[]): string {
  const rows = lines.map((l) => {
    const price = unitPrice(l.sku);
    return [
      csvCell(l.sku),
      csvCell(l.qty),
      "Good Inventory",
      csvCell(l.bin),
      price != null ? price : "",
      csvCell(l.batch ?? ""),
      "Yes",
    ].join(",");
  });
  return HEADER + "\n" + rows.join("\n") + "\n";
}
