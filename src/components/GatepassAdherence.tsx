import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "../lib/format";
import { fetchGatepassAdherence, type AdherenceLine, type GatepassAdherence as GatepassAdherenceRow } from "../lib/gatepassAdherenceSupabase";
import { Button, Card, Tag } from "./Ui";

interface DaySummary {
  date: string;
  gatepassCount: number;
  instructedQty: number;
  compliantQty: number;
  pct: number;
  rows: GatepassAdherenceRow[];
}

function byDay(rows: GatepassAdherenceRow[]): DaySummary[] {
  const groups = new Map<string, GatepassAdherenceRow[]>();
  for (const r of rows) {
    if (!groups.has(r.report_date)) groups.set(r.report_date, []);
    groups.get(r.report_date)!.push(r);
  }
  return [...groups.entries()]
    .map(([date, dayRows]) => {
      const instructedQty = dayRows.reduce((s, r) => s + r.instructed_qty, 0);
      const compliantQty = dayRows.reduce((s, r) => s + r.compliant_qty, 0);
      return {
        date,
        gatepassCount: dayRows.length,
        instructedQty,
        compliantQty,
        pct: instructedQty ? Math.round((compliantQty / instructedQty) * 10000) / 100 : 0,
        rows: dayRows,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

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

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--fefo-line)] bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--fefo-text)] dark:text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function GatepassDetail({ r }: { r: GatepassAdherenceRow }) {
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-900">
        <span className="flex items-center gap-1.5 text-xs">
          <b className="font-mono">{r.gatepass_code}</b>
          <span className="text-slate-500 dark:text-slate-400">{r.facility}</span>
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
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Instructed bin</th>
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Instructed batch</th>
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Instructed</th>
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Actual</th>
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Status</th>
              <th className="border-b border-slate-200 p-1 dark:border-slate-700">Picked bin / batch (qty)</th>
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
                <td className="border-b border-slate-100 p-1 font-mono dark:border-slate-700/60">{l.picked_bin_batch || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function GatepassAdherence() {
  const [rows, setRows] = useState<GatepassAdherenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGatepassAdherence(30)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => byDay(rows), [rows]);

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
  const bestDay = days.reduce((a, b) => (b.pct > a.pct ? b : a), days[0]);
  const worstDay = days.reduce((a, b) => (b.pct < a.pct ? b : a), days[0]);
  const expanded = days.find((d) => d.date === expandedDate) ?? null;

  return (
    <Card title="Gate pass adherence">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Was the instructed bin actually picked from, at the instructed quantity? Checked daily against yesterday's
          closed gate passes at SL Mother Hub, SL Ambient, and SL RX. Over-picking from the right bin isn't penalized —
          only a missing bin or a short pick is.
        </p>
        <Button variant="sm" onClick={() => downloadCsv(toCsv(rows), "gatepass_adherence.csv")}>
          Export CSV
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Overall adherence" value={`${overallPct}%`} sub={`${totalCompliant.toLocaleString()} / ${totalInstructed.toLocaleString()} units`} />
        <StatCard label="Gate passes checked" value={String(rows.length)} sub={`across ${days.length} day${days.length === 1 ? "" : "s"}`} />
        <StatCard label="Best day" value={`${bestDay.pct}%`} sub={bestDay.date} />
        <StatCard label="Worst day" value={`${worstDay.pct}%`} sub={worstDay.date} />
      </div>

      <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[520px] border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-900">Report Date</th>
              <th className="border-b border-slate-200 bg-slate-50 p-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Gate Passes</th>
              <th className="border-b border-slate-200 bg-slate-50 p-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Instructed Qty</th>
              <th className="border-b border-slate-200 bg-slate-50 p-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Compliant Qty</th>
              <th className="border-b border-slate-200 bg-slate-50 p-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Adherence %</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr
                key={d.date}
                onClick={() => setExpandedDate(expandedDate === d.date ? null : d.date)}
                className={`cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900 ${
                  expandedDate === d.date ? "bg-[var(--fefo-teal-50)] dark:bg-slate-900" : ""
                }`}
              >
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <span className="mr-1 inline-block w-3 text-[var(--fefo-muted)]">{expandedDate === d.date ? "▾" : "▸"}</span>
                  {d.date}
                </td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{d.gatepassCount}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{d.instructedQty.toLocaleString()}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">{d.compliantQty.toLocaleString()}</td>
                <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                  <Tag tone={pctTone(d.pct)}>{d.pct}%</Tag>
                </td>
              </tr>
            ))}
            <tr className="font-bold text-[var(--fefo-text)] dark:text-slate-100">
              <td className="p-1.5">Overall</td>
              <td className="p-1.5 text-right">{rows.length}</td>
              <td className="p-1.5 text-right">{totalInstructed.toLocaleString()}</td>
              <td className="p-1.5 text-right">{totalCompliant.toLocaleString()}</td>
              <td className="p-1.5 text-right">
                <Tag tone={pctTone(overallPct)}>{overallPct}%</Tag>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {expanded && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Gate passes on {expanded.date}
          </p>
          {expanded.rows.map((r) => (
            <GatepassDetail key={`${r.gatepass_code}-${r.report_date}`} r={r} />
          ))}
        </div>
      )}
    </Card>
  );
}
