import { binKey } from "../lib/engine";
import { facilityRank } from "../lib/facilities";
import { monLabel } from "../lib/format";
import { reservedFor, useStore } from "../lib/store";
import { Tag } from "./Ui";

export function InventoryTable() {
  const { stock, visibleFacilities, tasks } = useStore();
  const rows = stock
    .filter((b) => visibleFacilities.includes(b.location) && b.type === "Good" && b.active === "Active")
    .sort((a, b) => {
      const fr = facilityRank(a.location) - facilityRank(b.location);
      if (fr !== 0) return fr;
      const [za, na] = binKey(a.bin);
      const [zb, nb] = binKey(b.bin);
      return za < zb ? -1 : za > zb ? 1 : na - nb;
    });

  if (visibleFacilities.length === 0)
    return <p className="py-3 text-center text-xs text-slate-500">Tick a facility in the header to view its inventory.</p>;
  if (rows.length === 0)
    return <p className="py-3 text-center text-xs text-slate-500">No Good + Active stock in the selected facilities.</p>;

  const shown = rows.slice(0, 250);
  return (
    <>
      <p className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {rows.length.toLocaleString()} stock rows{rows.length > shown.length ? ` · showing first ${shown.length}` : ""}
      </p>
      <div className="max-h-96 overflow-auto">
      <table className="mt-1 w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU Name</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Location</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Expiry</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">On hand</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reserved</th>
            <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Avail</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {shown.map((b) => {
            const r = reservedFor(tasks, b.rid);
            return (
              <tr key={b.rid} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.location}</td>
                <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{b.sku}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.name}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.bin}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.batch}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{monLabel(b.exp)}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.qty}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{r ? <Tag tone="warn">{r}</Tag> : "0"}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.qty - r}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
