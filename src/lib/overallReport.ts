import type { PickingTask } from "./types";

export interface OverallReportRow {
  channel: string;
  demandQty: number;
  shortfallQty: number;
  picklistQty: number;
  notFoundQty: number;
  pickedQty: number;
}

/**
 * Channel-level rollup: how much demand was uploaded, how much of it
 * couldn't even be allocated (shortfall), how much made it onto a picklist,
 * how much a picker reported not-found, and how much was actually picked.
 */
export function overallReport(tasks: PickingTask[]): OverallReportRow[] {
  const byChannel = new Map<string, OverallReportRow>();

  function row(channel: string): OverallReportRow {
    let r = byChannel.get(channel);
    if (!r) {
      r = { channel, demandQty: 0, shortfallQty: 0, picklistQty: 0, notFoundQty: 0, pickedQty: 0 };
      byChannel.set(channel, r);
    }
    return r;
  }

  for (const t of tasks) {
    const r = row(t.channel);
    for (const d of t.demand) r.demandQty += d.qty;
    for (const s of t.shortfall) r.shortfallQty += s.qty;
    for (const f of t.facilities) {
      for (const l of f.lines) {
        r.picklistQty += l.qty;
        r.notFoundQty += l.nf ?? 0;
        r.pickedQty += l.picked ?? 0;
      }
    }
  }

  return [...byChannel.values()].sort((a, b) => a.channel.localeCompare(b.channel));
}
