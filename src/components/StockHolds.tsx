import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { FACILITY_PRIORITY } from "../lib/facilities";
import { downloadCsv } from "../lib/format";
import {
  AGE_BUCKETS,
  type AgeBucketKey,
  type AgeFacilityPivot,
  buildAgeFacilityPivot,
  groupHoldsByFacilityAndDate,
  holdAgeDays,
  holdAgeStatusBadge,
  holdMatchesAgeBucket,
  holdMatchesSearch,
  onHandQty,
  type HoldFacilityGroup,
} from "../lib/holds";
import { useStore } from "../lib/store";
import type { Hold, StockRow } from "../lib/types";
import { Button, Card, StatCard, Tag } from "./Ui";

function timeLabel(iso?: string): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

function dateLabel(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Aging colour cues, greenest = freshest / least urgent through reddest =
// oldest / most urgent — a quick-scan signal that repeats across the pivot's
// row accent, the distribution bar, and the "Filtered to" pill so the same
// colour always means the same age everywhere on this screen.
// - light/solid: the cell/pill treatment (solid+white when selected, same
//   pattern as the active facility tab).
// - rowTint: a faint full-row wash, the severity cue the leadership matrix
//   view is built around (no side border — that reads as an AI-slop tell).
// - bar: the flat fill used in the compact distribution bar.
// - subLabel: the SLA-stage caption under each bucket's pill.
// - heat: 4 steps (none/faint/medium/strong) of the SAME hue, from a cell
//   with little volume up to the busiest cell in its row — the "heat map"
//   read, done in one colour language instead of stacking a second one.
const AGE_BUCKET_STYLE: Record<AgeBucketKey, { light: string; solid: string; rowTint: string; bar: string; subLabel: string; heat: string[] }> = {
  lt2: {
    light: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    solid: "bg-emerald-600 text-white",
    rowTint: "bg-emerald-50/50 dark:bg-emerald-950/10",
    bar: "bg-emerald-500",
    subLabel: "Standard SLA",
    heat: ["", "bg-emerald-50 dark:bg-emerald-950/20", "bg-emerald-100 dark:bg-emerald-900/30", "bg-emerald-200 dark:bg-emerald-900/50"],
  },
  "2to5": {
    light: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    solid: "bg-amber-600 text-white",
    rowTint: "bg-amber-50/50 dark:bg-amber-950/10",
    bar: "bg-amber-500",
    subLabel: "Review window",
    heat: ["", "bg-amber-50 dark:bg-amber-950/20", "bg-amber-100 dark:bg-amber-900/30", "bg-amber-200 dark:bg-amber-900/50"],
  },
  "6to10": {
    light: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    solid: "bg-orange-600 text-white",
    rowTint: "bg-orange-50/50 dark:bg-orange-950/10",
    bar: "bg-orange-500",
    subLabel: "Critical aging",
    heat: ["", "bg-orange-50 dark:bg-orange-950/20", "bg-orange-100 dark:bg-orange-900/30", "bg-orange-200 dark:bg-orange-900/50"],
  },
  gt10: {
    light: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    solid: "bg-rose-600 text-white",
    rowTint: "bg-rose-50/50 dark:bg-rose-950/10",
    bar: "bg-rose-500",
    subLabel: "SLA breached",
    heat: ["", "bg-rose-50 dark:bg-rose-950/20", "bg-rose-100 dark:bg-rose-900/30", "bg-rose-200 dark:bg-rose-900/50"],
  },
};

/** Which of a bucket's 4 heat steps (index 0-3) a cell earns, relative to the busiest cell in its own row. */
function heatStepIndex(units: number, rowMax: number): number {
  if (rowMax <= 0 || units <= 0) return 0;
  const ratio = units / rowMax;
  return ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : ratio >= 0.05 ? 1 : 0;
}

/** Compact stacked bar showing each bucket's share of every unit currently on hold — the "shape" of the aging problem at a glance, before the numbers. */
function AgeDistributionBar({ pivot }: { pivot: AgeFacilityPivot }) {
  if (pivot.grandTotalUnits === 0) return null;
  return (
    <div className="mt-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {pivot.rows.map((row) => {
          const pct = (row.totalUnits / pivot.grandTotalUnits) * 100;
          if (pct <= 0) return null;
          return <div key={row.bucket} className={AGE_BUCKET_STYLE[row.bucket].bar} style={{ width: `${pct}%` }} title={`${row.label}: ${pct.toFixed(1)}%`} />;
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
        {pivot.rows.map((row) => (
          <span key={row.bucket} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${AGE_BUCKET_STYLE[row.bucket].bar}`} />
            {row.label} · {((row.totalUnits / pivot.grandTotalUnits) * 100).toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function csvFrom(header: string, rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return header + "\n" + rows.map((r) => r.map((v) => cell(String(v))).join(",")).join("\n") + "\n";
}

/** Holds still pending release, with their live current shelf qty. */
function activeCsv(active: Hold[], stock: StockRow[]): string {
  return csvFrom(
    "SKU,Facility,Bin,Batch,Qty on hold,Current shelf qty,Held since,Held by,Reason,Source picklist",
    active.map((h) => [
      h.sku,
      h.facility,
      h.bin,
      h.batch,
      String(h.qty),
      String(onHandQty(stock, h.sku, h.facility, h.bin, h.batch)),
      timeLabel(h.heldAt),
      h.heldBy,
      h.reason ?? "",
      h.sourceTaskNo ?? "",
    ]),
  );
}

function releasedCsv(released: Hold[]): string {
  return csvFrom(
    "SKU,Facility,Bin,Batch,Qty on hold,Held since,Held by,Reason,Source picklist,Released at,Released by",
    released.map((h) => [h.sku, h.facility, h.bin, h.batch, String(h.qty), timeLabel(h.heldAt), h.heldBy, h.reason ?? "", h.sourceTaskNo ?? "", timeLabel(h.releasedAt), h.releasedBy ?? ""]),
  );
}

/** One date's worth of holds within a facility — its own collapsible level, lazy like the facility above it. */
function DateGroup({
  date,
  holds,
  stock,
  canRelease,
  selected,
  onToggleOne,
  onToggleAll,
  onReleaseIds,
  bulkReleasing,
  now,
  maxCount,
}: {
  date: string;
  holds: Hold[];
  stock: StockRow[];
  canRelease: boolean;
  selected: Set<number>;
  onToggleOne: (id: number, checked: boolean) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
  onReleaseIds: (ids: number[]) => void;
  bulkReleasing: boolean;
  now: Date;
  maxCount: number;
}) {
  // Plain state instead of native <details>/<summary> — the summary row now
  // carries real buttons (Inspect, Release all), and a <button> nested
  // inside a <summary> (itself interactive content) is invalid HTML even
  // though browsers tolerate it; a controlled row sidesteps that cleanly.
  const [opened, setOpened] = useState(false);
  const ids = holds.map((h) => h.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  // `date` is already "YYYY-MM-DD" — holdAgeDays reads just the first 10
  // chars of whatever string it's given, so it works unchanged here.
  const badge = holdAgeStatusBadge(holdAgeDays(date, now));
  const loadPct = maxCount > 0 ? (holds.length / maxCount) * 100 : 0;

  return (
    <div className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={() => setOpened((o) => !o)} className="flex flex-1 items-center gap-2 text-left text-xs">
          <span className={`inline-block w-3 text-[var(--fefo-muted)] transition-transform ${opened ? "rotate-90" : ""}`}>▸</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{dateLabel(date)}</span>
          <Tag tone={badge.tone}>{badge.label}</Tag>
        </button>
        <div className="hidden min-w-[70px] max-w-[120px] flex-1 sm:block" title={`${holds.length} of the busiest date's ${maxCount} holds in this facility`}>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${loadPct}%` }} />
          </div>
        </div>
        <Tag tone="muted">
          {holds.length} hold{holds.length === 1 ? "" : "s"}
        </Tag>
        <button
          type="button"
          onClick={() => setOpened((o) => !o)}
          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          {opened ? "Collapse" : "Inspect"}
        </button>
        {canRelease && (
          <button
            type="button"
            onClick={() => onReleaseIds(ids)}
            disabled={bulkReleasing}
            className="rounded-md bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Release all
          </button>
        )}
      </div>
      {opened && (
        <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                {canRelease && (
                  <th className="w-6 border-b border-slate-200 p-1.5 dark:border-slate-700">
                    <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(ids, e.target.checked)} aria-label={`Select all holds on ${dateLabel(date)}`} />
                  </th>
                )}
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Bin</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Qty on hold</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Current shelf qty</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held since</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held by</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reason</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Source picklist</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                  {canRelease && (
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      <input type="checkbox" checked={selected.has(h.id)} onChange={(e) => onToggleOne(h.id, e.target.checked)} aria-label={`Select hold on ${h.sku} ${h.bin}`} />
                    </td>
                  )}
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{h.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{h.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{h.qty}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold text-rose-600 dark:border-slate-700/60 dark:text-rose-400">
                    {onHandQty(stock, h.sku, h.facility, h.bin, h.batch)}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.heldBy}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.reason ? <Tag tone="warn">{h.reason}</Tag> : "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.sourceTaskNo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// All 3 facilities are always clickable (the tab row), but only the
// selected one's holds render — full width, uninterrupted, not squeezed
// into a shared column. Switching tabs replaces this, it never stacks.
function FacilityPanel({
  group,
  stock,
  canRelease,
  selected,
  onToggleOne,
  onToggleAll,
  onReleaseIds,
  bulkReleasing,
  now,
}: {
  group: HoldFacilityGroup;
  stock: StockRow[];
  canRelease: boolean;
  selected: Set<number>;
  onToggleOne: (id: number, checked: boolean) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
  onReleaseIds: (ids: number[]) => void;
  bulkReleasing: boolean;
  now: Date;
}) {
  if (group.dates.length === 0) {
    return <p className="py-4 text-center text-xs text-slate-400">No active holds at {group.facility} right now.</p>;
  }
  // The busiest single date in this facility — every other date's load bar
  // is drawn relative to it, so the bars compare within the facility you're
  // actually looking at rather than against some unrelated global max.
  const maxCount = Math.max(0, ...group.dates.map((d) => d.holds.length));
  return (
    <div>
      {group.dates.map((d) => (
        <DateGroup
          key={d.date}
          date={d.date}
          holds={d.holds}
          stock={stock}
          canRelease={canRelease}
          selected={selected}
          onToggleOne={onToggleOne}
          onToggleAll={onToggleAll}
          onReleaseIds={onReleaseIds}
          bulkReleasing={bulkReleasing}
          now={now}
          maxCount={maxCount}
        />
      ))}
    </div>
  );
}

// The leadership view: aging (rows) x facility (columns), units on hold as
// the value. Clicking a cell jumps straight to that facility + bucket in
// the collapsible table below (switches the facility tab AND applies the
// age filter) — a drill-down from summary number to the actual line items.
// Clicking the already-selected cell again clears just the age filter.
function AgePivotTable({
  pivot,
  facilities,
  activeFacility,
  ageFilter,
  onSelectCell,
}: {
  pivot: AgeFacilityPivot;
  facilities: string[];
  activeFacility: string;
  ageFilter: AgeBucketKey | null;
  onSelectCell: (facility: string, bucket: AgeBucketKey) => void;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[var(--fefo-line)] bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col items-center gap-1.5 border-b border-[var(--fefo-line)] px-3 py-2.5 text-center dark:border-slate-700">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">Units on hold, by age and facility</p>
          <p className="text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">Click a cell to see those holds</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--fefo-muted)] dark:text-slate-400">
          <span className="mr-0.5 font-medium">Heat:</span>
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-100 dark:bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-500" />
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-500 dark:bg-slate-300" />
          <span>low → busiest cell in its row</span>
        </div>
      </div>
      <div className="border-b border-[var(--fefo-line)] px-3 py-2.5 dark:border-slate-700">
        <AgeDistributionBar pivot={pivot} />
      </div>
      <div className="overflow-x-auto">
        {/* table-fixed + colgroup: every row's cells line up in strict
            columns regardless of content length (a button vs. a header's
            two lines vs. a plain total) — auto layout let columns drift
            row to row, which read as "misaligned". */}
        <table className="w-full min-w-[560px] table-fixed border-collapse text-sm tabular-nums">
          <colgroup>
            <col style={{ width: "24%" }} />
            {facilities.map((f) => (
              <col key={f} style={{ width: `${64 / facilities.length}%` }} />
            ))}
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-2.5 text-left dark:border-slate-700">Age of hold</th>
              {facilities.map((f) => {
                const total = pivot.facilityTotals.find((ft) => ft.facility === f);
                const pct = total && pivot.grandTotalUnits > 0 ? (total.units / pivot.grandTotalUnits) * 100 : 0;
                return (
                  <th key={f} className="border-b border-slate-200 p-2.5 text-right dark:border-slate-700">
                    <div className="truncate">{f}</div>
                    <div className="text-[10px] font-normal normal-case text-slate-400 dark:text-slate-500">{total && total.units > 0 ? `Cap. ${pct.toFixed(1)}%` : "—"}</div>
                  </th>
                );
              })}
              <th className="border-b border-slate-200 p-2.5 text-right dark:border-slate-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => {
              const rowMax = Math.max(0, ...row.cells.map((c) => c.units));
              return (
                <tr key={row.bucket} className={AGE_BUCKET_STYLE[row.bucket].rowTint}>
                  <td className="border-b border-slate-100 p-2.5 dark:border-slate-700/60">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${AGE_BUCKET_STYLE[row.bucket].light}`}>{row.label}</span>
                    <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{AGE_BUCKET_STYLE[row.bucket].subLabel}</div>
                  </td>
                  {row.cells.map((cell) => {
                    const isSelected = ageFilter === row.bucket && activeFacility === cell.facility;
                    const clickable = cell.count > 0;
                    const heat = AGE_BUCKET_STYLE[row.bucket].heat[heatStepIndex(cell.units, rowMax)];
                    return (
                      <td key={cell.facility} className={`border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60 ${isSelected ? "" : heat}`}>
                        <button
                          onClick={() => clickable && onSelectCell(cell.facility, row.bucket)}
                          disabled={!clickable}
                          className={`w-full rounded-md px-2 py-1.5 transition-colors ${
                            isSelected
                              ? `${AGE_BUCKET_STYLE[row.bucket].solid} ring-2 ring-teal-500 ring-offset-1 dark:ring-offset-slate-900`
                              : clickable
                                ? "hover:bg-white/70 dark:hover:bg-slate-900/60"
                                : "cursor-default opacity-40"
                          }`}
                        >
                          <div className="text-lg font-bold">{cell.units.toLocaleString()}</div>
                          <div className={isSelected ? "text-[11px] text-white/80" : "text-[11px] text-slate-400"}>
                            {cell.count} hold{cell.count === 1 ? "" : "s"}
                          </div>
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-slate-100 p-2.5 text-right font-semibold text-slate-600 dark:border-slate-700/60 dark:text-slate-300">
                    {row.totalUnits.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <td className="p-2.5">
                <div>Facility totals</div>
                <div className="text-[10px] font-normal normal-case text-slate-400 dark:text-slate-500">Active hold load</div>
              </td>
              {pivot.facilityTotals.map((f) => (
                <td key={f.facility} className="p-2.5 text-right">
                  {f.units.toLocaleString()}
                </td>
              ))}
              <td className="p-2.5 text-right">{pivot.grandTotalUnits.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function StockHolds() {
  const holds = useStore((s) => s.holds);
  const stock = useStore((s) => s.stock);
  const releaseHold = useStore((s) => s.releaseHold);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const role = useAuth((s) => s.profile?.role);
  const canRelease = role === "admin" || role === "super_admin";
  const [bulkReleasing, setBulkReleasing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeFacility, setActiveFacility] = useState<string>(FACILITY_PRIORITY[0]);
  const [ageFilter, setAgeFilter] = useState<AgeBucketKey | null>(null);
  const now = new Date();

  const allActive = holds.filter((h) => !h.releasedAt);
  const allReleased = holds
    .filter((h) => h.releasedAt)
    .sort((a, b) => new Date(b.releasedAt ?? 0).getTime() - new Date(a.releasedAt ?? 0).getTime());

  const searchedActive = allActive.filter((h) => holdMatchesSearch(h, search));
  // Aging only applies to still-open holds needing triage — release history
  // is already resolved, so it stays search-only.
  const active = searchedActive.filter((h) => holdMatchesAgeBucket(h, ageFilter, now));
  const released = allReleased.filter((h) => holdMatchesSearch(h, search));
  // The pivot is scoped to search only (not the age filter, not the active
  // tab) — it's the summary you pick a bucket x facility cell FROM, so it
  // has to keep showing every bucket and every facility regardless of what's
  // currently selected.
  const pivot = buildAgeFacilityPivot(searchedActive, FACILITY_PRIORITY, now);
  const filterDescription = [search && `"${search}"`, ageFilter && AGE_BUCKETS.find((b) => b.key === ageFilter)?.label].filter(Boolean).join(" + ");

  // Headline stats above the matrix — distinct from the matrix's own detail,
  // this is the "read it in 5 seconds" version: how much is stuck, how much
  // of that is genuinely overdue, how bad is the worst single case, and
  // where is it concentrated.
  const urgentRows = pivot.rows.filter((r) => r.bucket === "6to10" || r.bucket === "gt10");
  const urgentUnits = urgentRows.reduce((s, r) => s + r.totalUnits, 0);
  const urgentCount = urgentRows.reduce((s, r) => s + r.totalCount, 0);
  const oldestAgeDays = searchedActive.length > 0 ? Math.max(...searchedActive.map((h) => holdAgeDays(h.heldAt, now))) : 0;
  const topFacility = pivot.facilityTotals.reduce((a, b) => (b.units > a.units ? b : a), pivot.facilityTotals[0]);
  const topFacilityPct = topFacility && pivot.grandTotalUnits > 0 ? Math.round((topFacility.units / pivot.grandTotalUnits) * 100) : 0;

  function selectPivotCell(facility: string, bucket: AgeBucketKey) {
    if (activeFacility === facility && ageFilter === bucket) {
      setAgeFilter(null); // clicking the already-selected cell again clears just the age filter
    } else {
      setActiveFacility(facility);
      setAgeFilter(bucket);
    }
  }
  // Always show all 3 facilities side by side, even one with zero matching
  // holds right now — groupHoldsByFacilityAndDate only returns facilities
  // that actually appear in `active`, so backfill any missing ones empty.
  const groupsByName = new Map(groupHoldsByFacilityAndDate(active, FACILITY_PRIORITY).map((g) => [g.facility, g]));
  const groups = FACILITY_PRIORITY.map((facility) => groupsByName.get(facility) ?? { facility, dates: [] });

  function toggleOne(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Shared by the top "Release N selected" button and each date row's own
  // "Release all" button — same confirm, same sequential release, same
  // busy-state, just a different source for which ids.
  async function releaseIds(ids: number[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`Release ${ids.length} hold(s)? Each becomes eligible for future picklists again.`)) return;
    setBulkReleasing(true);
    try {
      // Sequential, not Promise.all — each releaseHold() re-fetches holds
      // from Supabase afterward (see store.ts), so awaiting one at a time
      // keeps that re-fetch authoritative instead of racing on completion order.
      for (const id of ids) {
        await releaseHold(id, myName);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } finally {
      setBulkReleasing(false);
    }
  }
  async function releaseSelected() {
    await releaseIds([...selected]);
  }

  return (
    <Card title={`Stock holds (${allActive.length} active)`}>
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        A SKU + Facility + Bin + Batch combination lands here automatically whenever it's marked not-found during
        picking. "Qty on hold" is the shelf's stock level right after the picked amount was deducted (e.g. bin qty
        100, picked 5 → 95 on hold) — the entire remaining lot is excluded from every future picklist, fresh or
        round-2, until released. A hold is also auto-released the moment its lot's current shelf qty reaches 0 —
        nothing's left there to block — logged as released by "System (shelf emptied)" so it stays in the release
        history below rather than just disappearing. If that same lot gets restocked and goes not-found again later,
        a fresh hold is created then.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU, bin, or batch…"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        {canRelease && selected.size > 0 && (
          <Button variant="sm" onClick={() => void releaseSelected()} disabled={bulkReleasing}>
            {bulkReleasing ? "Releasing…" : `Release ${selected.size} selected`}
          </Button>
        )}
        <Button variant="sm" onClick={() => downloadCsv(activeCsv(active, stock), "stock_holds_pending_release.csv")} disabled={active.length === 0}>
          Export CSV
        </Button>
      </div>

      {allActive.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard icon="Σ" tone="info" label="Units on hold" value={pivot.grandTotalUnits.toLocaleString()} sub={`${pivot.grandTotalCount} hold${pivot.grandTotalCount === 1 ? "" : "s"}`} />
          <StatCard
            icon="!"
            tone={urgentUnits > 0 ? "bad" : "ok"}
            label="Aging > 6 days"
            value={urgentUnits.toLocaleString()}
            sub={urgentCount > 0 ? `${urgentCount} hold${urgentCount === 1 ? "" : "s"} need review` : "none right now"}
            highlight={urgentUnits > 0}
          />
          <StatCard
            icon="Δ"
            tone={oldestAgeDays > 10 ? "bad" : oldestAgeDays >= 6 ? "warn" : "ok"}
            label="Oldest hold"
            value={searchedActive.length > 0 ? `${oldestAgeDays} day${oldestAgeDays === 1 ? "" : "s"}` : "—"}
            sub="since it was placed"
          />
          <StatCard icon="%" tone="info" label="Top concentration" value={topFacility?.units ? topFacility.facility : "—"} sub={topFacility?.units ? `${topFacilityPct}% · ${topFacility.units.toLocaleString()} units` : undefined} />
        </div>
      )}

      {allActive.length > 0 && <AgePivotTable pivot={pivot} facilities={FACILITY_PRIORITY} activeFacility={activeFacility} ageFilter={ageFilter} onSelectCell={selectPivotCell} />}

      {ageFilter && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          Filtered to <span className={`rounded-full px-2 py-0.5 font-semibold ${AGE_BUCKET_STYLE[ageFilter].light}`}>{AGE_BUCKETS.find((b) => b.key === ageFilter)?.label}</span>
          at {activeFacility}
          <button onClick={() => setAgeFilter(null)} className="font-medium text-teal-700 underline dark:text-teal-400">
            Clear
          </button>
        </div>
      )}

      {allActive.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds right now.</p>
      ) : (
        <div>
          {/* Always visible and clickable, every facility, at any time — only the
              active one's holds render below; picking a different tab replaces
              it rather than opening alongside, so the view stays uninterrupted. */}
          <div className="mb-3 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
            {groups.map((g) => {
              const total = g.dates.reduce((s, d) => s + d.holds.length, 0);
              const isActive = g.facility === activeFacility;
              return (
                <button
                  key={g.facility}
                  onClick={() => setActiveFacility(g.facility)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {g.facility}
                  <span className={`rounded-full px-1.5 text-[10px] ${isActive ? "bg-white/20" : "bg-slate-200 dark:bg-slate-700"}`}>{total}</span>
                </button>
              );
            })}
          </div>

          {active.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds match {filterDescription || "the current filter"}.</p>
          ) : (
            (() => {
              const g = groups.find((x) => x.facility === activeFacility) ?? groups[0];
              return (
                <FacilityPanel
                  group={g}
                  stock={stock}
                  canRelease={canRelease}
                  selected={selected}
                  onToggleOne={toggleOne}
                  onToggleAll={toggleAll}
                  onReleaseIds={(ids) => void releaseIds(ids)}
                  bulkReleasing={bulkReleasing}
                  now={now}
                />
              );
            })()
          )}
        </div>
      )}

      {!canRelease && allActive.length > 0 && (
        <p className="mt-2 text-[10px] text-slate-400" title="Only Admin and Super Admin can release a hold">
          Releasing a hold requires Admin or Super Admin.
        </p>
      )}

      <div className="mt-5 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Release history</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {allReleased.length === 0
              ? "Nothing released yet."
              : search
                ? `${released.length} of ${allReleased.length} match "${search}"`
                : `${allReleased.length} released, all time`}
          </p>
        </div>
        <Button variant="sm" onClick={() => downloadCsv(releasedCsv(released), "stock_holds_released.csv")} disabled={released.length === 0}>
          Download CSV
        </Button>
      </div>
    </Card>
  );
}
