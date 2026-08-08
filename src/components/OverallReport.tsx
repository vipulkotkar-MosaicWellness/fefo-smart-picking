import { downloadCsv } from "../lib/format";
import { overallReport } from "../lib/overallReport";
import { activeTasks, useStore } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { PartnerMark } from "./partners/PartnerMark";
import { Button, Card } from "./Ui";

function toCsv(rows: ReturnType<typeof overallReport>): string {
  const header = "Channel,Demand Qty,Shortfall Qty,Picklist Qty,Not-Found Qty,Picked Qty";
  const body = rows.map((r) => [r.channel, r.demandQty, r.shortfallQty, r.picklistQty, r.notFoundQty, r.pickedQty].join(","));
  return header + "\n" + body.join("\n") + "\n";
}

export function OverallReport({ tasks: tasksProp }: { tasks?: PickingTask[] } = {}) {
  const storeTasks = useStore((s) => s.tasks);
  const tasks = tasksProp ?? activeTasks(storeTasks);
  const rows = overallReport(tasks);

  if (rows.length === 0) {
    return (
      <Card title="Overall report">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No demand in this range.</p>
      </Card>
    );
  }

  return (
    <Card title="Overall report">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Per channel: demand uploaded → allocation shortfall → picklist quantity → not-found → picked.
        </p>
        <Button variant="sm" onClick={() => downloadCsv(toCsv(rows), "overall_report.csv")}>
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Channel</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Demand</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Shortfall</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Picklist qty</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Not found</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Picked</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.channel} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60"><PartnerMark name={r.channel} /></td>
                <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{r.demandQty}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{r.shortfallQty}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{r.picklistQty}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{r.notFoundQty}</td>
                <td className="border-b border-slate-100 p-1.5 text-right font-semibold text-emerald-700 dark:border-slate-700/60 dark:text-emerald-400">
                  {r.pickedQty}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
