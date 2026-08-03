import { binKey, monthsRemaining } from "./engine";
import { facilityRank } from "./facilities";
import type { StockRow } from "./types";

export interface InventoryFilters {
  visibleFacilities: string[];
  text?: string; // SKU or product name
  batch?: string;
  location?: string; // bin
  minQty?: number;
  maxQty?: number;
}

/** On-hand stock only (Good + Active + qty > 0) within visible facilities, matching every set filter. */
export function filterStock(rows: StockRow[], f: InventoryFilters): StockRow[] {
  const text = f.text?.trim().toLowerCase();
  const batch = f.batch?.trim().toLowerCase();
  const location = f.location?.trim().toLowerCase();
  return rows.filter((b) => {
    if (!f.visibleFacilities.includes(b.location)) return false;
    if (b.type !== "Good" || b.active !== "Active" || b.qty <= 0) return false;
    if (text && !b.sku.toLowerCase().includes(text) && !b.name.toLowerCase().includes(text)) return false;
    if (batch && !b.batch.toLowerCase().includes(batch)) return false;
    if (location && !b.bin.toLowerCase().includes(location)) return false;
    if (f.minQty != null && b.qty < f.minQty) return false;
    if (f.maxQty != null && b.qty > f.maxQty) return false;
    return true;
  });
}

export type SortMode = "expiry" | "facility";

export function sortStock(rows: StockRow[], mode: SortMode): StockRow[] {
  return rows.slice().sort((a, b) => {
    if (mode === "expiry") {
      const ra = monthsRemaining(a.exp);
      const rb = monthsRemaining(b.exp);
      if (ra !== rb) return ra - rb;
    }
    const fr = facilityRank(a.location) - facilityRank(b.location);
    if (fr !== 0) return fr;
    const [za, na] = binKey(a.bin);
    const [zb, nb] = binKey(b.bin);
    return za < zb ? -1 : za > zb ? 1 : na - nb;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { items: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), totalPages };
}
