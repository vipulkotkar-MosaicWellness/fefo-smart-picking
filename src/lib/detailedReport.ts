import { effectiveGatePassNo } from "./store";
import type { PickingTask } from "./types";

export type DetailedReportStatus = "Picklist completed" | "Not found" | "Picking pending";

/** One instructed line, in the exact shape asked for: full end-to-end trace of a single bin+batch pick instruction. */
export interface DetailedReportRow {
  taskNo: string;
  channel: string;
  reportDate: string; // YYYY-MM-DD — when this facility picklist (round) was generated
  gatePassNo?: string; // undefined if gate pass is still pending
  facility: string;
  sku: string;
  name: string;
  bin: string;
  batch: string;
  qty: number;
  status: DetailedReportStatus;
}

/**
 * Line-level detail behind Overall Report's channel rollup: one row per
 * instructed bin+batch pick, across every open round of every picklist.
 * Status is derived per line, not per picklist — a picklist a picker is
 * still working through reports "Picking pending" for all its lines; once
 * completed, each line is either "Not found" (nf > 0) or "Picklist completed".
 */
export function detailedReport(tasks: PickingTask[]): DetailedReportRow[] {
  const rows: DetailedReportRow[] = [];
  for (const t of tasks) {
    for (const f of t.facilities) {
      if (f.discarded) continue;
      const gatePassNo = effectiveGatePassNo(f, t);
      const reportDate = (f.createdAt ?? t.createdAt).slice(0, 10);
      for (const l of f.lines) {
        const status: DetailedReportStatus = f.status !== "completed" ? "Picking pending" : (l.nf ?? 0) > 0 ? "Not found" : "Picklist completed";
        rows.push({ taskNo: t.no, channel: t.channel, reportDate, gatePassNo, facility: f.facility, sku: l.sku, name: l.name, bin: l.bin, batch: l.batch, qty: l.qty, status });
      }
    }
  }
  return rows.sort((a, b) => (b.reportDate === a.reportDate ? 0 : b.reportDate.localeCompare(a.reportDate)));
}
