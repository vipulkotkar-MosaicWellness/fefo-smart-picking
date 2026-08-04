import { primaryFacilityNo } from "./format";
import { unitPrice } from "./cogs";
import type { FacilityPicklist, PickLine } from "./types";

const HEADER = "Item Sku Code*,Qty,Inventory Type,Shelf Code,Unit Price,Uniware Batch Code,Force Allocate";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function lineRow(l: PickLine): string {
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
}

/**
 * Build the Uniware-import-ready CSV for one facility picklist's active
 * lines. Exactly the 7 columns Uniware's importer expects — never add a
 * column here, or the file stops being importable there.
 */
export function uniwareCsv(lines: PickLine[]): string {
  return HEADER + "\n" + lines.map(lineRow).join("\n") + "\n";
}

/**
 * Multi-picklist report CSV (used by the bucket-level "Download" buttons in
 * Picklist Repository, which already combine several picklists into one
 * file) — same columns as uniwareCsv, plus a trailing "Primary Picklist"
 * column so a supervisor can see which original picklist an alternate
 * (round 2+, raised for not-found stock) was generated against. Blank for a
 * primary picklist's own lines. Not meant for direct Uniware import.
 */
export function uniwareReportCsv(facilities: FacilityPicklist[]): string {
  const rows = facilities.flatMap((f) => {
    const primaryRef = f.round > 1 ? primaryFacilityNo(f.no) : "";
    return f.lines.map((l) => `${lineRow(l)},${csvCell(primaryRef)}`);
  });
  return `${HEADER},Primary Picklist\n${rows.join("\n")}\n`;
}
