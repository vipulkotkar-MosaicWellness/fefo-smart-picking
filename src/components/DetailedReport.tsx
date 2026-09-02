import { detailedReport, type DetailedReportRow, type DetailedReportStatus } from "../lib/detailedReport";
import { downloadCsv } from "../lib/format";
import { activeTasks, useStore } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

const STATUS_TONE: Record<DetailedReportStatus, "ok" | "warn" | "bad"> = {
  "Picklist completed": "ok",
  "Not found": "bad",
  "Picking pending": "warn",
};

function toCsv(rows: DetailedReportRow[]): string {
  const header = "Report Date,Task No,Channel,Gate Pass,Facility,SKU,SKU Name,Instructed Bin,Instructed Batch,Instructed Qty,Status";
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const body = rows.map((r) =>
    [r.reportDate, r.taskNo, r.channel, r.gatePassNo ?? "Pending", r.facility, r.sku, r.name, r.bin, r.batch, r.qty, r.status].map(cell).join(","),
  );
  return header + "\n" + body.join("\n") + "\n";
}

/**
 * Line-level detail behind Overall Report's channel rollup — one row per
 * instructed bin+batch pick: Report Date, Gate Pass, Facility, SKU, SKU
 * Name, Instructed Bin, Instructed Batch, Instructed Qty, Status.
 */
export function DetailedReport({ tasks: tasksProp }: { tasks?: PickingTask[] } = {}) {
  const storeTasks = useStore((s) => s.tasks);
  const tasks = tasksProp ?? activeTasks(storeTasks);
  const rows = detailedReport(tasks);

  if (rows.length === 0) {
    return (
      <Card title="Overall report — detailed">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No demand in this range.</p>
      </Card>
    );
  }

  return (
    <Card title={`Overall report — detailed (${rows.length})`}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Every instructed bin+batch pick line, end to end: which gate pass, which facility, which SKU, which bin
          and batch, how much, and whether it was picked, not found, or is still pending.
        </p>
        <Button variant="sm" onClick={() => downloadCsv(toCsv(rows), `overall_report_detailed_${new Date().toISOString().slice(0, 10)}.csv`)}>
          Export CSV
        </Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Report Date</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Channel</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Gate Pass</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Instructed Bin</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Instructed Batch</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Instructed Qty</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Status</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={`${r.taskNo}-${r.facility}-${r.bin}-${r.batch}-${i}`} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r.reportDate}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r.channel}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  {r.gatePassNo ?? <span className="text-amber-700 dark:text-amber-400">Pending</span>}{" "}
                  <span className="text-slate-400">· {r.taskNo}</span>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r.facility}</td>
                <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">
                  {r.sku}
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{r.name}</div>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r.bin}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r.batch}</td>
                <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{r.qty}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <Tag tone={STATUS_TONE[r.status]}>{r.status}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
