import { downloadCsv } from "../lib/format";
import { notFoundSummary } from "../lib/notFoundSummary";
import { activeTasks, useStore } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function toCsv(entries: ReturnType<typeof notFoundSummary>): string {
  const header = "SKU,Product,Total Not-Found Qty,Reason Breakdown,Facilities,Shelf/Bin,Picklists";
  const rows = entries.map((e) => {
    const reasons = Object.entries(e.byReason).map(([r, q]) => `${r}: ${q}`).join(" | ");
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [e.sku, e.name, e.totalQty, reasons, e.facilities.join(" | "), e.bins.join(" | "), e.picklists.join(" | ")].map((v) => cell(String(v))).join(",");
  });
  return header + "\n" + rows.join("\n") + "\n";
}

export function NotFoundSummary({ tasks: tasksProp }: { tasks?: PickingTask[] } = {}) {
  const storeTasks = useStore((s) => s.tasks);
  const tasks = tasksProp ?? activeTasks(storeTasks);
  const entries = notFoundSummary(tasks);

  if (entries.length === 0) {
    return (
      <Card title="Not-found summary">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Nothing marked not-found during picking yet.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Not-found summary">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Every SKU a picker reported not-found at the shelf, with why and where — largest shortfall first.
        </p>
        <Button variant="sm" onClick={() => downloadCsv(toCsv(entries), "not_found_summary.csv")}>
          Export CSV
        </Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Product</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Not-found qty</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reasons</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facilities</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Shelf / Bin</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Picklists</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.sku} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{e.sku}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{e.name}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{e.totalQty}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(e.byReason).map(([reason, qty]) => (
                      <Tag key={reason} tone="bad">{reason}: {qty}</Tag>
                    ))}
                  </div>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{e.facilities.join(", ")}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <div className="flex flex-wrap gap-1">
                    {e.bins.map((bin) => (
                      <Tag key={bin} tone="warn">{bin}</Tag>
                    ))}
                  </div>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <div className="flex flex-wrap gap-1">
                    {e.picklists.map((p) => (
                      <Tag key={p} tone="muted">{p}</Tag>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
