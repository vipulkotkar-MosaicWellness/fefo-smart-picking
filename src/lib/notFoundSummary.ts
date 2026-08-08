import type { PickingTask } from "./types";

export interface NotFoundEntry {
  sku: string;
  name: string;
  totalQty: number;
  byReason: Record<string, number>;
  facilities: string[];
  bins: string[]; // shelf/bin codes where the SKU was reported not-found — for investigation and action
  batches: string[]; // Uniware batch codes affected
  picklists: string[];
  latestNotFoundAt: string; // most recent contributing round's timestamp — drives the Ageing column
}

/** Every SKU marked not-found during picking, aggregated with reason breakdown — largest shortfall first. */
export function notFoundSummary(tasks: PickingTask[]): NotFoundEntry[] {
  const bySku = new Map<string, NotFoundEntry>();

  for (const t of tasks) {
    for (const f of t.facilities) {
      const roundTime = f.createdAt ?? t.createdAt;
      for (const l of f.lines) {
        if (!l.nf || l.nf <= 0) continue;
        let entry = bySku.get(l.sku);
        if (!entry) {
          entry = { sku: l.sku, name: l.name, totalQty: 0, byReason: {}, facilities: [], bins: [], batches: [], picklists: [], latestNotFoundAt: roundTime };
          bySku.set(l.sku, entry);
        }
        entry.totalQty += l.nf;
        const reason = l.nfReason ?? "Not specified";
        entry.byReason[reason] = (entry.byReason[reason] ?? 0) + l.nf;
        if (!entry.facilities.includes(f.facility)) entry.facilities.push(f.facility);
        if (!entry.bins.includes(l.bin)) entry.bins.push(l.bin);
        if (!entry.batches.includes(l.batch)) entry.batches.push(l.batch);
        if (!entry.picklists.includes(f.no)) entry.picklists.push(f.no);
        if (new Date(roundTime).getTime() > new Date(entry.latestNotFoundAt).getTime()) entry.latestNotFoundAt = roundTime;
      }
    }
  }

  return [...bySku.values()].sort((a, b) => b.totalQty - a.totalQty);
}
