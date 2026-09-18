import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  fetchGatepassAdherence,
  lineBreach,
  lineReason,
  lineTone,
  type GatepassAdherence as GatepassAdherenceRow,
} from "../lib/gatepassAdherenceSupabase";
import { fetchFefoDeviations, type FefoDeviationRow } from "../lib/fefoDeviationsSupabase";
import { computePurityMetrics } from "../lib/fefoPurityMetrics";
import { Button, StatCard, Tag } from "./Ui";

// The date case-based picking went live — everything on/after this splits
// into the new top section; everything before stays in the historical
// pure-FEFO baseline below. A plain literal, same convention as other
// fixed cutoff dates in this codebase (e.g. AdminConfig's cutoffDate).
const CASE_BASED_LAUNCH_DATE = "2026-09-17";

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

/** Monday of the Mon-Sun week containing this date, as YYYY-MM-DD. UTC throughout — report_date is a plain date string with no timezone of its own, matching byDay's convention. Exported for its own direct test — the Sunday boundary (step BACK 6 days, not forward) is the one branch here easy to get subtly wrong. */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** Same shape as byDay, one row per Mon-Sun week instead of per day — for the pure-FEFO historical baseline, which has too many days to read one-by-one. */
export function byWeek(rows: GatepassAdherenceRow[]): DaySummary[] {
  const groups = new Map<string, GatepassAdherenceRow[]>();
  for (const r of rows) {
    const wk = weekStart(r.report_date);
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk)!.push(r);
  }
  return [...groups.entries()]
    .map(([wk, weekRows]) => {
      const instructedQty = weekRows.reduce((s, r) => s + r.instructed_qty, 0);
      const compliantQty = weekRows.reduce((s, r) => s + r.compliant_qty, 0);
      return {
        date: wk,
        gatepassCount: weekRows.length,
        instructedQty,
        compliantQty,
        pct: instructedQty ? Math.round((compliantQty / instructedQty) * 10000) / 100 : 0,
        rows: weekRows,
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
        "FEFO Breach": lineBreach(l),
        Reason: lineReason(l),
        "Bin Match": l.bin_match ?? "",
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

function pctTone(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 95) return "ok";
  if (pct >= 80) return "warn";
  return "bad";
}

/** Whole-number percentage for display — the underlying figures (adherence_pct, etc.) carry 2 decimals for calculation, but reading a whole number is faster than reading "77.51%". */
function pctDisplay(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** Facility with the highest adherence % that day — the "(SL Hub)"-style detail under Best/Worst day. */
function topFacility(day: DaySummary): string | null {
  const byFac = new Map<string, { instr: number; comp: number }>();
  for (const r of day.rows) {
    const cur = byFac.get(r.facility) ?? { instr: 0, comp: 0 };
    cur.instr += r.instructed_qty;
    cur.comp += r.compliant_qty;
    byFac.set(r.facility, cur);
  }
  let best: { facility: string; pct: number } | null = null;
  for (const [facility, v] of byFac) {
    const pct = v.instr ? v.comp / v.instr : 0;
    if (!best || pct > best.pct) best = { facility, pct };
  }
  return best?.facility ?? null;
}

/** The single reason driving the most shortfall units that day, in a few words — a real, computed answer to "why was this the worst day", not a label. */
function topBreachReason(day: DaySummary): string | null {
  const tally = new Map<string, number>();
  for (const r of day.rows) {
    for (const l of r.lines) {
      if (lineBreach(l) !== "Yes") continue;
      const reason = lineReason(l);
      tally.set(reason, (tally.get(reason) ?? 0) + (l.instructed_qty - l.compliant_qty));
    }
  }
  let top: { reason: string; units: number } | null = null;
  for (const [reason, units] of tally) if (!top || units > top.units) top = { reason, units };
  if (!top) return null;
  if (top.reason === "Batch mismatch") return "mostly wrong-batch picks";
  if (top.reason === "Not picked") return "mostly unpicked lines";
  return top.reason;
}

/** Unit-weighted adherence % across a window of days — sums first, so one big day isn't diluted by several tiny ones. */
function windowPct(ds: DaySummary[]): number | null {
  const instr = ds.reduce((s, d) => s + d.instructedQty, 0);
  const comp = ds.reduce((s, d) => s + d.compliantQty, 0);
  return instr ? (comp / instr) * 100 : null;
}

// Same 3-tier read as everywhere else adherence is scored (pctTone below) —
// color here is status, not identity, so it gets a legend + a fixed order,
// never cycled or reused for anything else on this chart.
const ADHERENCE_STATUS = [
  { min: 95, color: "#10b981", label: "On target (≥95%)" },
  { min: 80, color: "#f59e0b", label: "Watch (80–94%)" },
  { min: 0, color: "#e11d48", label: "Below target (<80%)" },
];
function statusColor(pct: number): string {
  return ADHERENCE_STATUS.find((s) => pct >= s.min)!.color;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-02" -> "02 Sep" — day-then-month, fixed regardless of browser locale (unlike toLocaleDateString, which can flip the order). */
function shortDateLabel(dateStr: string): string {
  const [, m, day] = dateStr.split("-");
  return `${day} ${MONTH_ABBR[Number(m) - 1]}`;
}

export function TrendChart({ days, selectedDate, onSelectDate, showTrendline }: { days: DaySummary[]; selectedDate: string | null; onSelectDate: (date: string) => void; showTrendline?: boolean }) {
  const [hovered, setHovered] = useState<DaySummary | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Real measured width of the card the chart sits in, not a fixed pixel
  // guess — this is what makes the chart fill the actual available width
  // (centered, no dead space on the right) and re-flow on window resize /
  // different screen sizes, instead of rendering at a fixed small size
  // inside a wider card. 480 is only the first-paint fallback before the
  // ResizeObserver's first measurement lands.
  const [containerW, setContainerW] = useState(480);
  useEffect(() => {
    const el = containerRef.current;
    // Guards an environment with no ResizeObserver (older browsers, and
    // jsdom in tests) — the chart still renders correctly at the 480
    // fallback width, it just won't re-flow on resize there.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerW(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const h = 220;
  const padL = 40;
  const padR = 12;
  const padB = 30;
  // Extra headroom vs. before — the value label sits above the bar tip now,
  // so a day at/near 100% still needs clear room above it, not just above
  // the gridline.
  const padT = 26;
  const chartH = h - padT - padB;
  // A bar never gets thinner than this even when there are many days — past
  // that point the chart scrolls horizontally instead of shrinking bars to
  // unreadable slivers. Below that floor, bars spread out evenly to fill
  // the card's REAL width (via containerW) rather than clumping at a fixed
  // small size and leaving empty space on the right.
  const minSlot = 28;
  const chartW = Math.max(containerW - padL - padR, days.length * minSlot);
  const w = padL + chartW + padR;
  const slot = days.length > 0 ? chartW / days.length : chartW;
  // Bars stay readable-sized even when only a handful of days fill a wide
  // card — capped so they never balloon into fat blocks, evenly spaced
  // across the full slot width either way.
  const barW = Math.min(slot * 0.65, 44);
  // Shared by the bar tip, its value label, and the trendline dot below —
  // all three must floor the same way (a day at/near 0% never fully
  // collapses to the baseline) so they visually agree with each other.
  const pointX = (i: number) => padL + slot * i + slot / 2;
  const pointY = (pct: number) => padT + chartH - Math.max((pct / 100) * chartH, 2);

  return (
    <div>
      {/* Status legend — the fixed identity channel for the bar colours, since colour here means "how far from target", not "which day". */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--fefo-muted)] dark:text-slate-400">
        {ADHERENCE_STATUS.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative overflow-x-auto">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily adherence percentage trend, one bar per day">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padT + chartH - (tick / 100) * chartH;
            return (
              <g key={tick}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="currentColor" strokeOpacity={0.12} />
                <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="12.5" fill="currentColor" opacity={0.6}>
                  {tick}
                </text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const slotX = padL + slot * i;
            const barX = slotX + (slot - barW) / 2;
            const barH = Math.max((d.pct / 100) * chartH, 2);
            const y = pointY(d.pct);
            const isSelected = d.date === selectedDate;
            const isHovered = hovered?.date === d.date;
            return (
              <g key={d.date}>
                {/* Value bar */}
                <rect x={barX} y={y} width={barW} height={barH} rx={3} fill={statusColor(d.pct)} opacity={isHovered ? 1 : 0.88} />
                {isSelected && <rect x={barX - 2} y={y - 2} width={barW + 4} height={barH + 2} rx={4} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-teal-700 dark:text-teal-300" />}
                {/* Value at the tip — text token colour, never the bar's own hue, so it stays legible over any status colour. */}
                <text x={pointX(i)} y={y - 6} textAnchor="middle" fontSize="11" fontWeight={700} fill="currentColor" opacity={isHovered || isSelected ? 1 : 0.85}>
                  {pctDisplay(d.pct)}
                </text>
                <text x={pointX(i)} y={h - 9} textAnchor="middle" fontSize="11" fill="currentColor" opacity={isHovered || isSelected ? 0.95 : 0.6} fontWeight={isSelected ? 700 : 400}>
                  {shortDateLabel(d.date)}
                </text>
                {/* Hit target: the whole slot, taller than the bar, so a short bar (a bad day) is just as easy to hover/click as a tall one. */}
                <rect
                  x={slotX}
                  y={padT}
                  width={slot}
                  height={chartH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.date}: ${pctDisplay(d.pct)} adherence, ${d.gatepassCount} gate pass${d.gatepassCount === 1 ? "" : "es"}, ${d.compliantQty.toLocaleString()} of ${d.instructedQty.toLocaleString()} units compliant`}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setHovered(d)}
                  onMouseLeave={() => setHovered((cur) => (cur?.date === d.date ? null : cur))}
                  onFocus={() => setHovered(d)}
                  onBlur={() => setHovered((cur) => (cur?.date === d.date ? null : cur))}
                  onClick={() => onSelectDate(d.date)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectDate(d.date); } }}
                />
              </g>
            );
          })}
          {showTrendline && days.length > 1 && (
            <polyline
              points={days.map((d, i) => `${pointX(i)},${pointY(d.pct)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-teal-700 dark:text-teal-300"
              opacity={0.7}
              pointerEvents="none"
              aria-hidden="true"
            />
          )}
          {showTrendline &&
            days.length > 1 &&
            days.map((d, i) => (
              <circle
                key={`dot-${d.date}`}
                cx={pointX(i)}
                cy={pointY(d.pct)}
                r={3}
                fill="currentColor"
                className="text-teal-700 dark:text-teal-300"
                pointerEvents="none"
                aria-hidden="true"
              />
            ))}
          <line x1={padL} y1={padT + chartH} x2={w - padR} y2={padT + chartH} stroke="currentColor" strokeOpacity={0.25} />
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-800"
            style={{ left: padL + slot * (days.findIndex((d) => d.date === hovered.date) + 0.5), top: padT + chartH - (hovered.pct / 100) * chartH - 8 }}
          >
            <p className="font-bold text-slate-800 dark:text-slate-100">{pctDisplay(hovered.pct)} adherence</p>
            <p className="text-[var(--fefo-muted)] dark:text-slate-400">{hovered.date}</p>
            <p className="text-[var(--fefo-muted)] dark:text-slate-400">
              {hovered.compliantQty.toLocaleString()} / {hovered.instructedQty.toLocaleString()} units · {hovered.gatepassCount} gate pass{hovered.gatepassCount === 1 ? "" : "es"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function GatepassAdherence() {
  const [rows, setRows] = useState<GatepassAdherenceRow[]>([]);
  const [fefoDeviations, setFefoDeviations] = useState<FefoDeviationRow[]>([]);
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
    fetchFefoDeviations(CASE_BASED_LAUNCH_DATE)
      .then((r) => { if (!cancelled) setFefoDeviations(r); })
      .catch(() => { /* non-fatal — Metric 2 just shows 0 breach if this fails */ });
    return () => { cancelled = true; };
  }, []);

  const caseBasedRows = rows.filter((r) => r.report_date >= CASE_BASED_LAUNCH_DATE);
  const baselineRows = rows.filter((r) => r.report_date < CASE_BASED_LAUNCH_DATE);
  const caseBasedDays = useMemo(() => byDay(caseBasedRows), [caseBasedRows]);
  const baselineWeeks = useMemo(() => byWeek(baselineRows), [baselineRows]);
  const metric1Days = caseBasedDays.slice(-15);
  const metric2Days = caseBasedDays.slice(-15).map((d) => ({ ...d, pct: computePurityMetrics(d.rows, fefoDeviations).metric2Pct }));
  // Real day count shown in the window, not a hardcoded "15" — right after
  // launch there's only a handful of days, and a "Last 15 days" label would
  // overstate the window the chart/table actually cover.
  const windowDayCount = metric1Days.length;
  // Scoped to the SAME trailing window the charts/tables above show — not
  // all of caseBasedRows — so the breach-units subtitle can never silently
  // drift into showing a since-launch cumulative total once the case-based
  // era runs longer than 15 days.
  const windowRows = metric1Days.flatMap((d) => d.rows);
  const purity = computePurityMetrics(windowRows, fefoDeviations);

  const shellCls = "rounded-xl border border-[var(--fefo-line)] bg-[var(--fefo-surface)] p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800";

  if (loading) {
    return (
      <section className={shellCls}>
        <p className="py-3 text-center text-base text-slate-500 dark:text-slate-400">Loading…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={shellCls}>
        <p className="py-3 text-center text-base text-rose-600 dark:text-rose-400">Could not load: {error}</p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className={shellCls}>
        <p className="py-3 text-center text-base text-slate-500 dark:text-slate-400">
          Nothing scored yet — the daily check runs automatically each morning against yesterday's closed gate passes.
        </p>
      </section>
    );
  }

  const totalInstructed = baselineRows.reduce((s, r) => s + r.instructed_qty, 0);
  const totalCompliant = baselineRows.reduce((s, r) => s + r.compliant_qty, 0);
  const overallPct = totalInstructed ? Math.round((totalCompliant / totalInstructed) * 10000) / 100 : 0;
  const bestWeek = baselineWeeks.length ? baselineWeeks.reduce((a, b) => (b.pct > a.pct ? b : a), baselineWeeks[0]) : null;
  const worstWeek = baselineWeeks.length ? baselineWeeks.reduce((a, b) => (b.pct < a.pct ? b : a), baselineWeeks[0]) : null;
  const bestWeekFacility = bestWeek ? topFacility(bestWeek) : null;
  const worstWeekReason = worstWeek ? topBreachReason(worstWeek) : null;
  const expandedWeek = baselineWeeks.find((d) => d.date === expandedDate) ?? null;
  const expandedGp = expandedWeek?.rows.find((r) => r.gatepass_code === expandedGatepass) ?? null;

  const dateRangeLabel = baselineWeeks.length
    ? `${shortDateLabel(baselineWeeks[0].date)} – ${shortDateLabel(baselineWeeks[baselineWeeks.length - 1].date)}, ${baselineWeeks[baselineWeeks.length - 1].date.slice(0, 4)}`
    : "";
  const last7Pct = windowPct(baselineWeeks.slice(-7));
  const prior7 = baselineWeeks.slice(-14, -7);
  const prior7Pct = prior7.length >= 3 ? windowPct(prior7) : null;
  const trendDelta = last7Pct !== null && prior7Pct !== null ? last7Pct - prior7Pct : null;

  function selectDate(date: string) {
    setExpandedGatepass(null);
    setExpandedDate(expandedDate === date ? null : date);
  }

  return (
    <section className={shellCls}>
      {caseBasedRows.length > 0 && (
        <div className="mb-6 border-b border-[var(--fefo-line)] pb-6 dark:border-slate-700">
          <h2 className="mb-1 text-xl font-bold tracking-tight text-[var(--fefo-text)] dark:text-slate-100">
            Case-Based Picking — Live Since {shortDateLabel(CASE_BASED_LAUNCH_DATE)}
          </h2>
          <p className="mb-4 max-w-2xl text-sm text-[var(--fefo-muted)] dark:text-slate-400">
            Two numbers, day by day: whether the instructed batch was picked as instructed (unchanged method), and that
            same number further adjusted for units where case-first picking itself chose a later-expiry batch than strict
            FEFO would have.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-1 text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">Pure case-based %</p>
              <p className="mb-3 text-sm text-[var(--fefo-muted)] dark:text-slate-400">Last {windowDayCount} day{windowDayCount === 1 ? "" : "s"} · same compliance rule as always</p>
              <TrendChart days={metric1Days} selectedDate={null} onSelectDate={() => {}} showTrendline />
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-xs uppercase tracking-wide text-teal-800 dark:text-teal-300">
                      <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Date</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Pure case-based %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric1Days.map((d) => (
                      <tr key={d.date} className="text-slate-700 dark:text-slate-200">
                        <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{d.date}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.instructedQty.toLocaleString()}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{d.compliantQty.toLocaleString()}</td>
                        <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                          <Tag tone={pctTone(d.pct)}>{pctDisplay(d.pct)}</Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-1 text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">Case-based + FEFO breach %</p>
              <p className="mb-3 text-sm text-[var(--fefo-muted)] dark:text-slate-400">
                Last {windowDayCount} day{windowDayCount === 1 ? "" : "s"} · {purity.breachQty.toLocaleString()} units breached FEFO out of {purity.instructedQty.toLocaleString()}
              </p>
              <TrendChart days={metric2Days} selectedDate={null} onSelectDate={() => {}} showTrendline />
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-xs uppercase tracking-wide text-teal-800 dark:text-teal-300">
                      <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Date</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Breach units</th>
                      <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Case-based + FEFO breach %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric1Days.map((d) => {
                      const dayPurity = computePurityMetrics(d.rows, fefoDeviations);
                      return (
                        <tr key={d.date} className="text-slate-700 dark:text-slate-200">
                          <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{d.date}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{dayPurity.instructedQty.toLocaleString()}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">{dayPurity.breachQty.toLocaleString()}</td>
                          <td className="border-b border-slate-100 p-2 text-right dark:border-slate-700/60">
                            <Tag tone={pctTone(dayPurity.metric2Pct)}>{pctDisplay(dayPurity.metric2Pct)}</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--fefo-line)] pb-4 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-[var(--fefo-text)] dark:text-slate-100">Pure-FEFO Baseline — Pick Compliance &amp; Fulfillment Accuracy</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fefo-muted)] dark:text-slate-400">
            The historical record from before case-based picking went live on {shortDateLabel(CASE_BASED_LAUNCH_DATE)} — was
            the instructed batch actually picked, at the instructed quantity? Checked daily against each day's closed gate
            passes at SL Mother Hub, SL Ambient, and SL RX. Picking the right batch from a different shelf isn't penalized —
            only a wrong batch, a missed pick, or a short pick is. See the section above for the current, case-based era.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--fefo-line)] bg-[var(--fefo-teal-50)] px-3 py-1.5 text-xs font-semibold text-[var(--fefo-teal-900)] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            {dateRangeLabel}
          </span>
          <Button variant="sm" onClick={() => exportWorkbook(baselineRows)}>
            Export Excel
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard icon="%" tone={pctTone(overallPct)} label="Overall adherence" value={pctDisplay(overallPct)} sub={`${totalCompliant.toLocaleString()} / ${totalInstructed.toLocaleString()} units`} />
        <StatCard icon="Σ" tone="info" label="Gate passes audited" value={String(baselineRows.length)} sub={`across ${baselineWeeks.length} week${baselineWeeks.length === 1 ? "" : "s"}`} />
        <StatCard icon="↑" tone="ok" label="Best week" value={bestWeek ? shortDateLabel(bestWeek.date) : "—"} sub={bestWeek ? `${pctDisplay(bestWeek.pct)}${bestWeekFacility ? ` · ${bestWeekFacility}` : ""}` : ""} />
        <StatCard icon="↓" tone="bad" label="Worst week" value={worstWeek ? shortDateLabel(worstWeek.date) : "—"} sub={worstWeek ? `${pctDisplay(worstWeek.pct)}${worstWeekReason ? ` · ${worstWeekReason}` : ""}` : ""} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div id="gpa-daily-log" className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">Weekly log breakdown</p>
            <span className="rounded-full bg-[var(--fefo-teal-50)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fefo-teal-900)] dark:bg-slate-700 dark:text-slate-300">
              {baselineWeeks.length} record{baselineWeeks.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          {/* table-fixed + percentage col widths, not a min-width — this is
              what lets the table fit within the card at normal desktop
              widths instead of forcing horizontal scroll. */}
          <table className="w-full table-fixed border-collapse text-[12.5px] tabular-nums">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[16%]" />
              <col className="w-[19%]" />
              <col className="w-[19%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">Week Starting</th>
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Gate Passes</th>
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Instructed</th>
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Compliant</th>
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right dark:border-slate-700 dark:bg-slate-900">Adherence</th>
              </tr>
            </thead>
            <tbody>
              {baselineWeeks.map((d) => (
                <tr
                  key={d.date}
                  onClick={() => selectDate(d.date)}
                  className={`cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900 ${
                    expandedDate === d.date ? "bg-[var(--fefo-teal-50)] dark:bg-slate-900" : ""
                  }`}
                >
                  <td className="truncate border-b border-slate-100 px-2 py-1 dark:border-slate-700/60">
                    <span className="mr-1 inline-block w-2.5 text-[var(--fefo-muted)]">{expandedDate === d.date ? "▾" : "▸"}</span>
                    {d.date}
                  </td>
                  <td className="border-b border-slate-100 px-2 py-1 text-right dark:border-slate-700/60">{d.gatepassCount}</td>
                  <td className="border-b border-slate-100 px-2 py-1 text-right dark:border-slate-700/60">{d.instructedQty.toLocaleString()}</td>
                  <td className="border-b border-slate-100 px-2 py-1 text-right dark:border-slate-700/60">{d.compliantQty.toLocaleString()}</td>
                  <td className="border-b border-slate-100 px-2 py-1 text-right dark:border-slate-700/60">
                    <Tag tone={pctTone(d.pct)}>{pctDisplay(d.pct)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* tfoot + sticky bottom-0 — the Overall row stays visually
                distinct (tinted background, heavier top border) and stays
                in view while scrolling through a longer weekly list. */}
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-[var(--fefo-text)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <td className="px-2 py-1.5">Overall</td>
                <td className="px-2 py-1.5 text-right">{baselineRows.length}</td>
                <td className="px-2 py-1.5 text-right">{totalInstructed.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right">{totalCompliant.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right">
                  <Tag tone={pctTone(overallPct)}>{pctDisplay(overallPct)}</Tag>
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-1 text-lg font-bold tracking-wide text-[var(--fefo-text)] uppercase dark:text-slate-100">
            Pure-FEFO baseline — weekly
          </p>
          <p className="mb-3 text-sm text-[var(--fefo-muted)] dark:text-slate-400">Every week before case-based picking went live.</p>
          <TrendChart days={baselineWeeks} selectedDate={expandedDate} onSelectDate={selectDate} showTrendline />
          {trendDelta !== null && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--fefo-line)] pt-3 text-xs dark:border-slate-700">
              <p className="text-[var(--fefo-muted)] dark:text-slate-400">
                <span className={`font-semibold ${trendDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {trendDelta >= 0 ? "▲" : "▼"} {Math.abs(trendDelta).toFixed(1)} pt {trendDelta >= 0 ? "recovery" : "decline"}
                </span>{" "}
                over the last 7 weeks vs. the previous 7
              </p>
              <a href="#gpa-daily-log" className="font-semibold text-teal-700 hover:underline dark:text-teal-300">
                Full weekly log ↓
              </a>
            </div>
          )}
        </div>
      </div>

      {expandedWeek && (
        <div className="mb-4">
          <p className="mb-1.5 text-base font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Gate passes for week of {expandedWeek.date}
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
                {expandedWeek.rows.map((r) => (
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
                      <Tag tone={pctTone(r.adherence_pct)}>{pctDisplay(r.adherence_pct)}</Tag>
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
            <table className="w-full min-w-[960px] border-collapse text-base">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-sm uppercase tracking-wide text-teal-800 dark:text-teal-300">
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">SKU</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">SKU Name</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Instructed Bin</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Instructed Batch</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Instructed Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Actual Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 text-right dark:border-slate-700 dark:bg-slate-900">Compliant Qty</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">FEFO Breach</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Reason</th>
                  <th className="border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">Bin Match</th>
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
                      <Tag tone={lineBreach(l) === "Yes" ? "bad" : "ok"}>{lineBreach(l)}</Tag>
                    </td>
                    <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">
                      <Tag tone={lineTone(l)}>{lineReason(l)}</Tag>
                    </td>
                    <td className="border-b border-slate-100 p-2 dark:border-slate-700/60">{l.bin_match ?? "—"}</td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.picked_bin_batch || "—"}</td>
                    <td className="border-b border-slate-100 p-2 font-mono dark:border-slate-700/60">{l.vendor_batch || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
