import { useState, type ChangeEvent } from "react";
import { criticalPathSort } from "../lib/engine";
import { downloadCsv, monLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { uniwareCsv } from "../lib/uniwareExport";
import type { FacilityPicklist } from "../lib/types";
import { Button, Tag } from "./Ui";

/** The full picklist detail: assignment controls, share buttons, line table, complete button. */
export function FacilityBlock({ f }: { f: FacilityPicklist }) {
  const { pickers, assignAll, assignLine, uploadAssignments, applyPicks } = useStore();
  const [nf, setNf] = useState<Record<number, number>>({});
  const [assignTo, setAssignTo] = useState("");
  const open = f.status === "open";
  const lines = criticalPathSort(f.lines);
  const seq = new Map<number, number>();
  lines.forEach((l, i) => seq.set(l.rid, i + 1));

  function shareRows() {
    return lines.map((l, i) => ({ sr: i + 1, bin: l.bin, sku: l.sku, name: l.name, qty: l.qty, picker: l.picker ?? "" }));
  }
  function copy() {
    const txt =
      `${f.no} · ${f.facility}\nSr#\tLocation\tSKU\tSKU Name\tQty\tPicker\n` +
      shareRows().map((r) => `${r.sr}\t${r.bin}\t${r.sku}\t${r.name}\t${r.qty}\t${r.picker}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => alert("Picklist copied."), () => alert("Copy blocked; use CSV."));
  }
  function csv() {
    // Uniware-import-ready format: SKU, Qty, Inventory Type, Shelf Code, Unit
    // Price (from the COGS sheet), Batch Code, Force Allocate.
    downloadCsv(uniwareCsv(lines), `${f.no}.csv`);
  }
  function print() {
    const html =
      `<h2>${f.no}</h2><p>${f.facility}</p><table border=1 cellpadding=6 style="border-collapse:collapse;font-family:Arial"><tr><th>Sr #</th><th>Location</th><th>SKU / SKU Name</th><th>Qty</th><th>Picker</th><th>Picked</th></tr>` +
      shareRows().map((r) => `<tr><td>${r.sr}</td><td>${r.bin}</td><td>${r.sku}<br><small>${r.name}</small></td><td>${r.qty}</td><td>${r.picker}</td><td></td></tr>`).join("") +
      `</table>`;
    const w = window.open("", "_blank");
    if (!w) return alert("Allow pop-ups to print.");
    w.document.write(`<title>${f.no}</title>${html}`);
    w.document.close();
    w.print();
  }
  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => void uploadAssignments(f.no, String(r.result));
    r.readAsText(file);
  }
  function complete() {
    const results: Record<number, number> = {};
    lines.forEach((l) => (results[l.rid] = nf[l.rid] ?? 0));
    void applyPicks(f.no, results);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <b>{f.taskNo}</b> <span className="text-xs text-slate-500 dark:text-slate-400">{f.no}</span>{" "}
          {f.round > 1 && <Tag tone="info">Round {f.round}</Tag>}
          {f.bad ? <span className="ml-1 text-xs text-rose-600 dark:text-rose-400">· {f.bad} not found</span> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="sm" onClick={copy}>Copy</Button>
          <Button variant="sm" onClick={csv}>CSV</Button>
          <Button variant="sm" onClick={print}>Print</Button>
          {open && <Button variant="green" onClick={complete}>Mark completed</Button>}
        </div>
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Assign all to</span>
          <select
            value={assignTo}
            onChange={(e) => {
              setAssignTo(e.target.value);
              if (e.target.value) void assignAll(f.no, e.target.value);
            }}
            className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="">— picker —</option>
            {pickers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-600">
            Upload assignments
            <input type="file" accept=".csv" className="hidden" onChange={onUpload} />
          </label>
        </div>
      )}

      <div className="my-1.5 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <b>Pick path</b>: {lines.map((l) => l.bin).join(" → ")}
      </div>
      {f.gp && (
        <div className="my-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          Gatepass {f.gp} · picked {f.pickedTotal}{f.bad ? ` · ${f.bad} not found` : ""}
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
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Picker</th>
              {open && <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Not found</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {lines.map((l) => (
              <tr key={l.rid} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{seq.get(l.rid)}</td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{l.bin}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  {l.sku}
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{l.name} · {l.batch} · exp {monLabel(l.exp)} ({l.rem}m)</div>
                </td>
                <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">
                  {open ? l.qty : (l.picked ?? l.qty)}
                  {!open && l.nf ? <> <Tag tone="bad">{l.nf} NF</Tag></> : null}
                </td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  {open ? (
                    <select
                      value={l.picker ?? ""}
                      onChange={(e) => void assignLine(l.rid, f.no, e.target.value)}
                      className="rounded border border-slate-300 p-1 text-[11px] dark:border-slate-600 dark:bg-slate-900"
                    >
                      <option value="">—</option>
                      {pickers.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    l.picker || "—"
                  )}
                </td>
                {open && (
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    <input
                      type="number"
                      min={0}
                      max={l.qty}
                      value={nf[l.rid] ?? 0}
                      onChange={(e) => setNf({ ...nf, [l.rid]: parseInt(e.target.value, 10) || 0 })}
                      className="w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
