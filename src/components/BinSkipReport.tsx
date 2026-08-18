import { binSkipReport, type BinSkipEntry } from "../lib/binSkipReport";
import { downloadCsv } from "../lib/format";
import { activeTasks, useStore } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toCsv(entries: BinSkipEntry[]): string {
  const header = "Date,Channel,Gate Pass,Picklist,SKU,Product,Facility,Bin,Batch,Qty Available,Threshold";
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = entries.map((e) =>
    [timeLabel(e.createdAt), e.channel, e.gatePassNo, e.taskNo, e.sku, e.name, e.facility, e.bin, e.batch, e.qtyAvailable, e.threshold]
      .map((v) => cell(String(v)))
      .join(","),
  );
  return header + "\n" + rows.join("\n") + "\n";
}

/**
 * Bin+batch lots the allocator passed over because a channel's minBinQty
 * floor wasn't met (see ChannelRule.minBinQty) — e.g. Internal Stock
 * Transfer - Warehouse only wants full case-pack quantities, so a bin with
 * fewer units left sits here instead of being picked, for Inventory to act on.
 */
export function BinSkipReport({ tasks: tasksProp }: { tasks?: PickingTask[] } = {}) {
  const storeTasks = useStore((s) => s.tasks);
  const tasks = tasksProp ?? activeTasks(storeTasks);
  const entries = binSkipReport(tasks);

  if (entries.length === 0) {
    return (
      <Card title="Bin skip report">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Nothing skipped for a minimum-bin-quantity floor yet.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Bin skip report (${entries.length})`}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Bin+batch lots that were FEFO-eligible but skipped because their available quantity fell under the
          channel's minimum — flag these to Inventory for reallocation.
        </p>
        <Button variant="sm" onClick={() => downloadCsv(toCsv(entries), "bin_skip_report.csv")}>
          Export CSV
        </Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Date</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Channel</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Gate Pass / Picklist</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility / Bin</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch #</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Qty available</th>
              <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Threshold</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {entries.map((e, i) => (
              <tr key={`${e.taskNo}-${e.bin}-${e.batch}-${i}`} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(e.createdAt)}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{e.channel}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  {e.gatePassNo} <span className="text-slate-400">· {e.taskNo}</span>
                </td>
                <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">
                  {e.sku}
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{e.name}</div>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  {e.facility} <span className="font-semibold">· {e.bin}</span>
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{e.batch}</td>
                <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{e.qtyAvailable}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                  <Tag tone="warn">&lt; {e.threshold}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
