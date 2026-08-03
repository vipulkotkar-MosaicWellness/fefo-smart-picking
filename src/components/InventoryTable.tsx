import { monthsRemaining } from "../lib/engine";
import { monLabel } from "../lib/format";
import type { Expiry, StockRow } from "../lib/types";
import { Tag } from "./Ui";

/** Manufacturing month = expiry minus total shelf life (exact at month level). */
function mfgFrom(exp: Expiry, shelf: number): Expiry {
  const total = exp[0] * 12 + (exp[1] - 1) - shelf;
  return [Math.floor(total / 12), (total % 12) + 1];
}

export function severityOf(rem: number, shelf: number): { pct: number; tone: "ok" | "warn" | "bad"; label: string } {
  const pct = shelf ? Math.max(0, Math.round((rem / shelf) * 100)) : 0;
  if (pct >= 50) return { pct, tone: "ok", label: "Healthy" };
  if (pct >= 25) return { pct, tone: "warn", label: "Watch" };
  return { pct, tone: "bad", label: "Critical" };
}

export function InventoryTable({ rows, onSelect }: { rows: StockRow[]; onSelect: (row: StockRow) => void }) {
  if (rows.length === 0) return <p className="py-3 text-center text-xs text-slate-500">No on-hand stock matches these filters.</p>;

  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
          <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU Name</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Location</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Expiry</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">On hand</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Shelf life left</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((b) => {
            const rem = monthsRemaining(b.exp);
            const sev = severityOf(rem, b.shelf);
            return (
              <tr
                key={b.rid}
                onClick={() => onSelect(b)}
                className="cursor-pointer text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(b)}
              >
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.location}</td>
                <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{b.sku}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.name}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.bin}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.batch}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{monLabel(b.exp)}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.qty}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <Tag tone={sev.tone}>{sev.label} · {sev.pct}%</Tag>
                  <span className="ml-1 text-[10px] text-slate-400">({rem}m/{b.shelf}m)</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BatchDetailDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const rem = monthsRemaining(row.exp);
  const sev = severityOf(rem, row.shelf);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Batch detail — ${row.sku}`}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl dark:bg-slate-800"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Batch detail</h3>
          <button onClick={onClose} className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600" autoFocus>
            Close
          </button>
        </div>
        <dl className="space-y-2.5 text-xs">
          {[
            ["SKU", row.sku],
            ["Product", row.name],
            ["Facility", row.location],
            ["Location / bin", row.bin],
            ["Batch", row.batch],
            ["Manufactured", monLabel(mfgFrom(row.exp, row.shelf))],
            ["Expiry", monLabel(row.exp)],
            ["On hand", String(row.qty)],
            ["Total shelf life", `${row.shelf} months`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Shelf life remaining</dt>
            <dd className="mt-0.5">
              <Tag tone={sev.tone}>{sev.label} · {sev.pct}%</Tag> <span className="text-slate-500 dark:text-slate-400">({rem} of {row.shelf} months)</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
