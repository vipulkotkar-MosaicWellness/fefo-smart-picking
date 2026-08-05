import type { PickingTask } from "./types";

export interface NotFoundEntry {
  sku: string;
  name: string;
  totalQty: number;
  byReason: Record<string, number>;
  facilities: string[];
  picklists: string[];
}

/** Every SKU marked not-found during picking, aggregated with reason breakdown — largest shortfall first. */
export function notFoundSummary(tasks: PickingTask[]): NotFoundEntry[] {
  const bySku = new Map<string, NotFoundEntry>();

  for (const t of tasks) {
    for (const f of t.facilities) {
      for (const l of f.lines) {
        if (!l.nf || l.nf <= 0) continue;
        let entry = bySku.get(l.sku);
        if (!entry) {
          entry = { sku: l.sku, name: l.name, totalQty: 0, byReason: {}, facilities: [], picklists: [] };
          bySku.set(l.sku, entry);
        }
        entry.totalQty += l.nf;
        const reason = l.nfReason ?? "Not specified";
        entry.byReason[reason] = (entry.byReason[reason] ?? 0) + l.nf;
        if (!entry.facilities.includes(f.facility)) entry.facilities.push(f.facility);
        if (!entry.picklists.includes(f.no)) entry.picklists.push(f.no);
      }
    }
  }

  return [...bySku.values()].sort((a, b) => b.totalQty - a.totalQty);
}
