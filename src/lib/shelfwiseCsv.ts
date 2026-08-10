import { FACILITY_PRIORITY } from "./facilities";

/** One row parsed from the raw Shelfwise export, ready to write to the `stock` table. */
export interface ShelfwiseStockRow {
  facility: string;
  bin: string;
  sku: string;
  name: string;
  batch: string | null;
  expiry: string | null; // "YYYY-MM-DD" or null
  qty: number;
  shelf: number; // total shelf life in months
}

export interface ParseShelfwiseResult {
  rows: ShelfwiseStockRow[];
  totalRows: number; // data rows seen, before filtering
  dropped: { facility: number; invType: number; status: number; qtyZero: number };
}

// CSV header name -> the field we use it for. Mirrors apps-script/ShelfwiseIngest.gs's
// COLUMNS exactly, so a file that works with the automated pipeline also works here.
const COLUMNS = {
  facility: "Facility",
  sku: "Item Type SKU Code",
  name: "Item Type Name",
  invType: "Inventory Type",
  bin: "Shelf",
  qty: "Quantity",
  batch: "Batch Code",
  expiry: "Expiry",
  mfg: "Manufacturing",
  status: "Batch Status",
} as const;

/** Splits one CSV line into fields, honoring double-quoted fields that may contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Whole months from `mfg` to `exp`; falls back to 24 when either date is unusable. */
function shelfMonths(mfg: string, exp: string): number {
  const m = new Date(mfg);
  const e = new Date(exp);
  if (isNaN(m.getTime()) || isNaN(e.getTime())) return 24;
  const months = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth());
  return months > 0 ? months : 24;
}

function toIsoDate(v: string): string | null {
  const s = (v || "").trim().slice(0, 10);
  return s || null;
}

/**
 * Parse a raw Shelfwise export CSV (same file the automated Apps Script
 * reads) into stock rows ready to upload, filtered to the 3 target
 * facilities, Good + Active stock with qty > 0 — identical filtering to
 * apps-script/ShelfwiseIngest.gs, so this fallback and the automated
 * pipeline never disagree about what counts as usable stock.
 */
export function parseShelfwiseCsv(text: string): ParseShelfwiseResult {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], totalRows: 0, dropped: { facility: 0, invType: 0, status: 0, qtyZero: 0 } };

  const header = splitCsvLine(lines[0]);
  const idx: Record<keyof typeof COLUMNS, number> = {} as Record<keyof typeof COLUMNS, number>;
  for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    const pos = header.indexOf(COLUMNS[key]);
    if (pos < 0) {
      throw new Error(
        `Expected column "${COLUMNS[key]}" not found in export header. The report format changed. Header was: ${header.join(" | ")}`,
      );
    }
    idx[key] = pos;
  }

  const dropped = { facility: 0, invType: 0, status: 0, qtyZero: 0 };
  const rows: ShelfwiseStockRow[] = [];
  const dataLines = lines.slice(1);

  for (const line of dataLines) {
    const r = splitCsvLine(line);
    const facility = r[idx.facility];
    if (!FACILITY_PRIORITY.includes(facility)) {
      dropped.facility++;
      continue;
    }
    if (r[idx.invType] !== "GOOD_INVENTORY") {
      dropped.invType++;
      continue;
    }
    if (r[idx.status] !== "Active") {
      dropped.status++;
      continue;
    }
    const qty = parseInt(r[idx.qty], 10);
    if (!qty || qty <= 0) {
      dropped.qtyZero++;
      continue;
    }
    rows.push({
      facility,
      bin: r[idx.bin] || "DEFAULT",
      sku: r[idx.sku],
      name: r[idx.name],
      batch: r[idx.batch] || null,
      expiry: toIsoDate(r[idx.expiry]),
      qty,
      shelf: shelfMonths(r[idx.mfg], r[idx.expiry]),
    });
  }

  return { rows, totalRows: dataLines.length, dropped };
}
