import { useState } from "react";
import { criticalPathSort } from "../lib/engine";
import { downloadCsv, monLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { MasterPicklist, PickLine } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function pickable(pl: MasterPicklist): PickLine[] {
  return criticalPathSort(pl.lines.filter((l) => !l.noElig && !l.shortLine && l.qty > 0));
}

function shareRows(pl: MasterPicklist) {
  return pickable(pl).map((l, i) => ({ sr: i + 1, bin: l.bin, sku: l.sku, name: l.name, qty: l.qty }));
}

function PicklistCard({ pl }: { pl: MasterPicklist }) {
  const markCompleted = useStore((s) => s.markCompleted);
  const [nf, setNf] = useState<Record<number, number>>({});
  const open = pl.status === "open";
  const pick = pickable(pl);
  const seq = new Map<number, number>();
  pick.forEach((l, i) => seq.set(l.rid as number, i + 1));

  function copy() {
    const rows = shareRows(pl);
    const txt =
      `${pl.no} · ${pl.location} · ${pl.channel}\nSr#\tLocation\tSKU\tSKU Name\tQty\n` +
      rows.map((r) => `${r.sr}\t${r.bin}\t${r.sku}\t${r.name}\t${r.qty}`).join("\n");
    navigator.clipboard.writeText(txt).then(
      () => alert("Picklist copied — paste into WhatsApp / email / Sheets."),
      () => alert("Copy blocked; use CSV."),
    );
  }
  function csv() {
    const rows = shareRows(pl);
    downloadCsv(
      "Sr #,Location,SKU Code,SKU Name,Qty\n" +
        rows.map((r) => `${r.sr},${r.bin},${r.sku},"${r.name}",${r.qty}`).join("\n") + "\n",
      `${pl.no}.csv`,
    );
  }
  function print() {
    const rows = shareRows(pl);
    const html =
      `<h2>${pl.no}</h2><p>${pl.location} · ${pl.channel}</p>` +
      `<table border=1 cellpadding=6 style="border-collapse:collapse;font-family:Arial"><tr><th>Sr #</th><th>Location</th><th>SKU / SKU Name</th><th>Qty</th><th>Picked</th></tr>` +
      rows.map((r) => `<tr><td>${r.sr}</td><td>${r.bin}</td><td>${r.sku}<br><small>${r.name}</small></td><td>${r.qty}</td><td></td></tr>`).join("") +
      `</table>`;
    const w = window.open("", "_blank");
    if (!w) {
      alert("Allow pop-ups to print.");
      return;
    }
    w.document.write(`<title>${pl.no}</title>${html}`);
    w.document.close();
    w.print();
  }

  return (
    <div className={`mb-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700 ${open ? "border-l-4 border-l-amber-500" : "border-l-4 border-l-emerald-600"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <b>{pl.no}</b> <Tag tone={open ? "warn" : "ok"}>{pl.status}</Tag>{" "}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            · {pl.location} · {pl.channel} · bad-loc: {pl.bad}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="sm" onClick={copy}>Copy</Button>
          <Button variant="sm" onClick={csv}>CSV</Button>
          <Button variant="sm" onClick={print}>Print</Button>
          {open && (
            <Button variant="green" onClick={() => markCompleted(pl.no, nf)}>
              Mark completed
            </Button>
          )}
        </div>
      </div>

      {pick.length > 0 && (
        <div className="my-1.5 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          <b>Critical pick path</b>: {pick.map((l) => l.bin).join(" → ")}
        </div>
      )}
      {pl.gp && (
        <div className="my-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          Gatepass {pl.gp} · picked {pl.pickedTotal} units{pl.bad ? ` · ${pl.bad} to bad location` : ""}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="mt-1 w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Sr #</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Location</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU / SKU Name</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Qty</th>
              {open && <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Not found</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pl.lines.map((l, i) => {
              if (l.noElig)
                return (
                  <tr key={i}>
                    <td className="p-1.5">—</td>
                    <td className="p-1.5">—</td>
                    <td className="p-1.5">{l.name} <Tag tone="bad">No eligible stock</Tag></td>
                    <td className="p-1.5">—</td>
                    {open && <td className="p-1.5">—</td>}
                  </tr>
                );
              if (l.shortLine)
                return (
                  <tr key={i}>
                    <td className="p-1.5">—</td>
                    <td className="p-1.5">—</td>
                    <td className="p-1.5">{l.name} <Tag tone="warn">Short by {l.qty}</Tag></td>
                    <td className="p-1.5">—</td>
                    {open && <td className="p-1.5">—</td>}
                  </tr>
                );
              const rid = l.rid as number;
              return (
                <tr key={i} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{seq.get(rid) ?? ""}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{l.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {l.sku}
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {l.name} · {l.batch} · exp {monLabel(l.exp)} ({l.rem}m)
                    </div>
                  </td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">
                    {open ? l.qty : (l.picked ?? l.qty)}
                    {!open && l.nf ? <> <Tag tone="bad">{l.nf} NF</Tag></> : null}
                  </td>
                  {open && (
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      <input
                        type="number"
                        min={0}
                        max={l.qty}
                        value={nf[rid] ?? 0}
                        onChange={(e) => setNf({ ...nf, [rid]: parseInt(e.target.value, 10) || 0 })}
                        className="w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
          Enter <b>Not-found qty</b> per line (0 = all found), then click <b>Mark completed</b>.
        </p>
      )}
    </div>
  );
}

export function RegisterPanel() {
  const picklists = useStore((s) => s.picklists);
  return (
    <Card title="3 · Master picklist register">
      {picklists.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          No master picklist yet. Upload stock, add demand, and click <b>Generate</b>.
        </p>
      ) : (
        picklists.slice().reverse().map((pl) => <PicklistCard key={pl.no} pl={pl} />)
      )}
    </Card>
  );
}
