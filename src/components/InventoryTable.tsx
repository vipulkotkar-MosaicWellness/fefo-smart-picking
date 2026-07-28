import { binKey, monthsRemaining } from "../lib/engine";
import { facilityRank } from "../lib/facilities";
import { monLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { Expiry } from "../lib/types";
import { Tag } from "./Ui";

/** Manufacturing month = expiry minus total shelf life (exact at month level). */
function mfgFrom(exp: Expiry, shelf: number): Expiry {
  const total = exp[0] * 12 + (exp[1] - 1) - shelf;
  return [Math.floor(total / 12), (total % 12) + 1];
}

export function InventoryTable() {
  const { stock, visibleFacilities, skuFilter } = useStore();
  const needle = skuFilter.trim().toLowerCase();
  const rows = stock
    .filter(
      (b) =>
        visibleFacilities.includes(b.location) &&
        b.type === "Good" &&
        b.active === "Active" &&
        b.qty > 0 && // on-hand stock only
        (!needle || b.sku.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle)),
    )
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
    return <p className="py-3 text-center text-xs text-slate-500">No on-hand stock in the selected facilities.</p>;

  const shown = rows.slice(0, 250);
  return (
    <>
      <p className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {rows.length.toLocaleString()} on-hand stock rows{rows.length > shown.length ? ` · showing first ${shown.length}` : ""}
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
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Mfg</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Expiry</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">On hand</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Shelf life left</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map((b) => {
              const rem = monthsRemaining(b.exp);
              const pct = b.shelf ? Math.max(0, Math.round((rem / b.shelf) * 100)) : 0;
              return (
                <tr key={b.rid} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.location}</td>
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{b.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.name}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{b.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{monLabel(mfgFrom(b.exp, b.shelf))}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{monLabel(b.exp)}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{b.qty}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    <Tag tone={pct >= 50 ? "ok" : pct >= 25 ? "warn" : "bad"}>{pct}%</Tag>
                    <span className="ml-1 text-[10px] text-slate-400">({rem}m/{b.shelf}m)</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
