import { useStore } from "../lib/store";
import { Card, Tag } from "./Ui";

export function PerformancePanel() {
  const { picklists, skus } = useStore();
  const done = picklists.filter((p) => p.status === "completed");

  if (done.length === 0)
    return (
      <Card title="4 · Sold / performance (completed picklists)">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Complete a master picklist to see demand vs sold (fill rate).
        </p>
      </Card>
    );

  const agg: Record<string, { name: string; dem: number; sold: number }> = {};
  done.forEach((pl) => {
    pl.demand.forEach((d) => {
      agg[d.sku] = agg[d.sku] ?? { name: skus[d.sku]?.name ?? d.sku, dem: 0, sold: 0 };
      agg[d.sku].dem += d.qty;
    });
    pl.lines.forEach((l) => {
      if (l.picked != null) {
        agg[l.sku] = agg[l.sku] ?? { name: l.name, dem: 0, sold: 0 };
        agg[l.sku].sold += l.picked;
      }
    });
  });

  let td = 0;
  let ts = 0;
  const rows = Object.values(agg).map((a) => {
    td += a.dem;
    ts += a.sold;
    const f = a.dem ? Math.round((a.sold / a.dem) * 100) : 0;
    return { ...a, f };
  });
  const fill = td ? Math.round((ts / td) * 100) : 0;

  return (
    <Card title="4 · Sold / performance (completed picklists)">
      <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
        Completed: {done.length} · overall fill rate <b>{fill}%</b>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Demand</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Sold / picked</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Fill</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.name} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{a.name}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{a.dem}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{a.sold}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <Tag tone={a.f >= 100 ? "ok" : a.f > 0 ? "warn" : "bad"}>{a.f}%</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
