import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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

/** Two sheets: gate-pass rollup, and full line-level detail. Report Date and Facility are
 * repeated on both sheets so either can be filtered/traced without cross-referencing the other. */
function exportWorkbook(rows: GatepassAdherenceRow[]) {
  const summarySheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      "Report Date": r.report_date,
      "Gate Pass": r.gatepass_code,
      Facility: r.facility,
      "Instructed Qty": r.instructed_qty,
      "Compliant Qty": r.compliant_qty,
      "Adherence %": r.adherence_pct,
    })),
  );

  const detailSheet = XLSX.utils.json_to_sheet(
    rows.flatMap((r) =>
      r.lines.map((l) => ({
        "Report Date": r.report_date,
        "Gate Pass": r.gatepass_code,
        Facility: r.facility,
        SKU: l.sku,
        "SKU Name": l.name ?? "",
        "Instructed Bin": l.bin,
        "Instructed Batch": l.batch,
        "Instructed Qty": l.instructed_qty,
        "Actual Qty": l.actual_qty,
        "Compliant Qty": l.compliant_qty,
        Status: l.status,
        "Actually Picked Bin/Batch (Qty)": l.picked_bin_batch ?? "",
        "Vendor Batch #": l.vendor_batch ?? "",
      })),
    ),
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, "Gate Pass Summary");
  XLSX.utils.book_append_sheet(wb, detailSheet, "Line Detail");
  XLSX.writeFile(wb, "gatepass_adherence.xlsx");
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

const TONE_TEXT: Record<"ok" | "warn" | "bad" | "info", string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  info: "text-[var(--fefo-teal-700)] dark:text-teal-300",
};
const TONE_BADGE: Record<"ok" | "warn" | "bad" | "info", string> = {
  ok: "bg-emerald-100 dark:bg-emerald-900/40",
  warn: "bg-amber-100 dark:bg-amber-900/40",
  bad: "bg-rose-100 dark:bg-rose-900/40",
  info: "bg-[var(--fefo-teal-50)] dark:bg-slate-700",
};

function StatCard({ icon, tone, label, value, sub }: { icon: string; tone: "ok" | "warn" | "bad" | "info"; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--fefo-line)] bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold ${TONE_BADGE[tone]} ${TONE_TEXT[tone]}`}>
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
        <p className={`mt-0.5 text-4xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
        {sub && <p className="text-sm text-[var(--fefo-muted)] dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function TrendChart({ days }: { days: DaySummary[] }) {
  const w = 560;
  const h = 220;
  const padL = 42;
  const padB = 32;
  const padT = 20;
  const chartW = w - padL - 10;
  const chartH = h - padT - padB;
  const barW = Math.min(36, (chartW / days.length) * 0.55);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Daily adherence percentage trend">
      {[0, 25, 50, 75, 100].map((tick) => {
        const y = padT + chartH - (tick / 100) * chartH;
        return (
          <g key={tick}>
            <line x1={padL} y1={y} x2={w - 6} y2={y} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="2,3" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="13" fill="currentColor" opacity={0.65}>
              {tick}
            </text>
          </g>
        );
      })}
      {days.map((d, i) => {
        const x = padL + (chartW / days.length) * (i + 0.5) - barW / 2;
        const barH = (d.pct / 100) * chartH;
        const y = padT + chartH - barH;
        const color = d.pct >= 95 ? "#10b981" : d.pct >= 80 ? "#f59e0b" : "#e11d48";
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx={3} fill={color} />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="14" fontWeight={700} fill="currentColor">
              {d.pct}%
            </text>
            <text x={x + barW / 2} y={h - 8} textAnchor="middle" fontSize="12.5" fill="currentColor" opacity={0.7}>
              {d.date.slice(5)}
            </text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + chartH} x2={w - 6} y2={padT + chartH} stroke="currentColor" strokeOpacity={0.25} />
    </svg>
  );
}

export function GatepassAdherence() {
  const [rows, setRows] = useState<GatepassAdherenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedGatepass, setExpandedGatepass] = useState<string | null>(null);

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
        <p className="py-3 text-center text-base text-slate-500 dark:text-slate-400">Loading…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Gate pass adherence">
        <p className="py-3 text-center text-base text-rose-600 dark:text-rose-400">Could not load: {error}</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Gate pass adherence">
        <p className="py-3 text-center text-base text-slate-500 dark:text-slate-400">
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
  const expandedDay = days.find((d) => d.date === expandedDate) ?? null;
  const expandedGp = expandedDay?.rows.find((r) => r.gatepass_code === expandedGatepass) ?? null;

  function selectDate(date: string) {
    setExpandedGatepass(null);
    setExpandedDate(expandedDate === date ? null : date);
  }

  return (
    <Card title="Gate pass adherence">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-slate-500 dark:text-slate-400">
          Was the instructed bin actually picked from, at the instructed quantity? Checked daily against yesterday's
          closed gate passes at SL Mother Hub, SL Ambient, and SL RX. Over-picking from the right bin isn't penalized —
          only a missing bin or a short pick is.
        </p>
        <Button variant="sm" onClick={() => exportWorkbook(rows)}>
          Export Excel
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard icon="%" tone={pctTone(overallPct)} label="Overall adherence" value={`${overallPct}%`} sub={`${totalCompliant.toLocaleString()} / ${totalInstructed.toLocaleString()} units`} />
        <StatCard icon="Σ" tone="info" label="Gate passes checked" value={String(rows.length)} sub={`across ${days.length} day${days.length === 1 ? "" : "s"}`} />
        <StatCard icon="↑" tone="ok" label="Best day" value={`${bestDay.pct}%`} sub={bestDay.date} />
        <StatCard icon="↓" tone="bad" label="Worst day" value={`${worstDay.pct}%`} sub={worstDay.date} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[520px] border-collapse text-lg tabular-nums">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-base uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Report Date</th>
                <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Gate Passes</th>
                <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed Qty</th>
                <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant Qty</th>
                <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Adherence %</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr
                  key={d.date}
                  onClick={() => selectDate(d.date)}
                  className={`cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900 ${
                    expandedDate === d.date ? "bg-[var(--fefo-teal-50)] dark:bg-slate-900" : ""
                  }`}
                >
                  <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">
                    <span className="mr-1 inline-block w-3 text-[var(--fefo-muted)]">{expandedDate === d.date ? "▾" : "▸"}</span>
                    {d.date}
                  </td>
                  <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.gatepassCount}</td>
                  <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.instructedQty.toLocaleString()}</td>
                  <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.compliantQty.toLocaleString()}</td>
                  <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                    <Tag tone={pctTone(d.pct)}>{d.pct}%</Tag>
                  </td>
                </tr>
              ))}
              <tr className="font-bold text-[var(--fefo-text)] dark:text-slate-100">
                <td className="p-2">Overall</td>
                <td className="p-2 text-right">{rows.length}</td>
                <td className="p-2 text-right">{totalInstructed.toLocaleString()}</td>
                <td className="p-2 text-right">{totalCompliant.toLocaleString()}</td>
                <td className="p-2 text-right">
                  <Tag tone={pctTone(overallPct)}>{overallPct}%</Tag>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-[var(--fefo-line)] bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-1 text-base font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Daily adherence trend
          </p>
          <TrendChart days={days} />
        </div>
      </div>

      {expandedDay && (
        <div className="mb-4">
          <p className="mb-1.5 text-base font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Gate passes on {expandedDay.date}
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[480px] border-collapse text-lg tabular-nums">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-base uppercase tracking-wide text-teal-800 dark:text-teal-300">
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Gate Pass</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Facility</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Adherence %</th>
                </tr>
              </thead>
              <tbody>
                {expandedDay.rows.map((r) => (
                  <tr
                    key={r.gatepass_code}
                    onClick={() => setExpandedGatepass(expandedGatepass === r.gatepass_code ? null : r.gatepass_code)}
                    className={`cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900 ${
                      expandedGatepass === r.gatepass_code ? "bg-[var(--fefo-teal-50)] dark:bg-slate-900" : ""
                    }`}
                  >
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">
                      <span className="mr-1 inline-block w-3 text-[var(--fefo-muted)]">{expandedGatepass === r.gatepass_code ? "▾" : "▸"}</span>
                      {r.gatepass_code}
                    </td>
                    <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{r.facility}</td>
                    <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{r.instructed_qty.toLocaleString()}</td>
                    <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{r.compliant_qty.toLocaleString()}</td>
                    <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                      <Tag tone={pctTone(r.adherence_pct)}>{r.adherence_pct}%</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expandedGp && (
        <div>
          <p className="mb-1.5 text-base font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Line detail for {expandedGp.gatepass_code}
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[720px] border-collapse text-base">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-sm uppercase tracking-wide text-teal-800 dark:text-teal-300">
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">SKU</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">SKU Name</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Instructed Bin</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Instructed Batch</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Actual Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Status</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Actually Picked Bin/Batch (Qty)</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Vendor Batch #</th>
                </tr>
              </thead>
              <tbody>
                {expandedGp.lines.map((l, i) => (
                  <tr key={`${l.bin}-${l.batch}-${i}`} className="text-slate-700 dark:text-slate-200">
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.sku}</td>
                    <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{l.name || "—"}</td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.bin}</td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.batch}</td>
                    <td className="border-b border-slate-100 p-2 text-right tabular-nums dark:border-slate-700/60">{l.instructed_qty}</td>
                    <td className="border-b border-slate-100 p-2 text-right tabular-nums dark:border-slate-700/60">{l.actual_qty}</td>
                    <td className="border-b border-slate-100 p-2 text-right tabular-nums dark:border-slate-700/60">{l.compliant_qty}</td>
                    <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">
                      <Tag tone={lineTone(l.status)}>{l.status}</Tag>
                    </td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.picked_bin_batch || "—"}</td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.vendor_batch || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
