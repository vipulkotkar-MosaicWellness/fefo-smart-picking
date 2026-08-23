import { useEffect, useState } from "react";
import { downloadCsv } from "../lib/format";
import { fetchGatepassAdherence, type AdherenceLine, type GatepassAdherence as GatepassAdherenceRow } from "../lib/gatepassAdherenceSupabase";
import { Button, Card, Tag } from "./Ui";

function toCsv(rows: GatepassAdherenceRow[]): string {
  const header = "Report Date,Gate Pass,Facility,Instructed Qty,Compliant Qty,Adherence %";
  const body = rows
    .map((r) => [r.report_date, r.gatepass_code, r.facility, r.instructed_qty, r.compliant_qty, r.adherence_pct].join(","))
    .join("\n");
  return header + "\n" + body + "\n";
}

function lineTone(status: AdherenceLine["status"]): "ok" | "warn" | "bad" {
  if (status === "OK") return "ok";
  if (status === "PARTIAL") return "warn";
  return "bad";
}

function pctTone(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 95) return "ok";
  if (pct >= 80) return "warn";
  return "bad";
}

export function GatepassAdherence() {
  const [rows, setRows] = useState<GatepassAdherenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGatepassAdherence(30)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card title="Gate pass adherence">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Gate pass adherence">
        <p className="py-3 text-center text-xs text-rose-600 dark:text-rose-400">Could not load: {error}</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Gate pass adherence">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Nothing scored yet — the daily check runs automatically each morning against yesterday's closed gate passes.
        </p>
      </Card>
    );
  }

  const totalInstructed = rows.reduce((s, r) => s + r.instructed_qty, 0);
  const totalCompliant = rows.reduce((s, r) => s + r.compliant_qty, 0);
  const overallPct = totalInstructed ? Math.round((totalCompliant / totalInstructed) * 10000) / 100 : 0;

  return (
    <Card title="Gate pass adherence">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Was the instructed bin actually picked from, at the instructed quantity? Checked daily against yesterday's
          closed gate passes at SL Mother Hub, SL Ambient, and SL RX. Over-picking from the right bin isn't penalized —
          only a missing bin or a short pick is.
        </p>
        <div className="flex items-center gap-2">
          <Tag tone={pctTone(overallPct)}>{overallPct}% overall</Tag>
          <Button variant="sm" onClick={() => downloadCsv(toCsv(rows), "gatepass_adherence.csv")}>
            Export CSV
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <details
            key={`${r.gatepass_code}-${r.report_date}`}
            className="rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-900">
              <span className="flex items-center gap-1.5 text-xs">
                <b className="font-mono">{r.gatepass_code}</b>
                <span className="text-slate-500 dark:text-slate-400">{r.facility} · {r.report_date}</span>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                {r.compliant_qty}/{r.instructed_qty} units
                <Tag tone={pctTone(r.adherence_pct)}>{r.adherence_pct}%</Tag>
              </span>
            </summary>
            <div className="border-t border-slate-200 p-2 dark:border-slate-700">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-teal-800 dark:text-teal-300">
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">SKU</th>
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">Bin</th>
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">Batch</th>
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">Instructed</th>
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">Actual</th>
                    <th className="border-b border-slate-200 p-1 dark:border-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={`${l.bin}-${l.batch}-${i}`} className="text-slate-700 dark:text-slate-200">
                      <td className="border-b border-slate-100 p-1 font-mono dark:border-slate-700/60">{l.sku}</td>
                      <td className="border-b border-slate-100 p-1 font-mono dark:border-slate-700/60">{l.bin}</td>
                      <td className="border-b border-slate-100 p-1 font-mono dark:border-slate-700/60">{l.batch}</td>
                      <td className="border-b border-slate-100 p-1 dark:border-slate-700/60">{l.instructed_qty}</td>
                      <td className="border-b border-slate-100 p-1 dark:border-slate-700/60">{l.actual_qty}</td>
                      <td className="border-b border-slate-100 p-1 dark:border-slate-700/60">
                        <Tag tone={lineTone(l.status)}>{l.status}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}
