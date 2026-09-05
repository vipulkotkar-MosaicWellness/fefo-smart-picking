import { useMemo, useState } from "react";
import { ageingRangeFor, inAgeingRange, type AgeingPreset } from "../lib/ageing";
import { primaryFacilityNo } from "../lib/format";
import { activeTasks, effectiveGatePassNo, supervisorVisibleFacilityLists, useStore } from "../lib/store";
import { bucketSummary, queueBucket, queueMetrics } from "../lib/supervisorMetrics";
import type { FacilityPicklist, PickingTask } from "../lib/types";
import { AgeingFilter } from "./AgeingFilter";
import { PartnerMark } from "./partners/PartnerMark";
import { Card, Tag } from "./Ui";
import { FacilityBlock } from "./FacilityBlock";

function summary(f: FacilityPicklist) {
  const qty = f.lines.reduce((s, l) => s + l.qty, 0);
  const assigned = f.lines.filter((l) => l.picker).length;
  return `${f.lines.length} line(s) · ${qty} units${assigned ? ` · ${assigned}/${f.lines.length} assigned` : ""}`;
}

function channelOf(f: FacilityPicklist, tasks: ReturnType<typeof useStore.getState>["tasks"]): string {
  return tasks.find((t) => t.no === f.taskNo)?.channel ?? "";
}

function gatePassOf(f: FacilityPicklist, tasks: ReturnType<typeof useStore.getState>["tasks"]): string | undefined {
  return effectiveGatePassNo(f, tasks.find((t) => t.no === f.taskNo));
}

function createdAtOf(f: FacilityPicklist, tasks: ReturnType<typeof useStore.getState>["tasks"]): string {
  return f.createdAt ?? tasks.find((t) => t.no === f.taskNo)?.createdAt ?? new Date(0).toISOString();
}

function PicklistItem({
  f,
  channel,
  gatePassNo,
  queuePos,
}: {
  f: FacilityPicklist;
  channel: string;
  gatePassNo?: string;
  queuePos?: number;
}) {
  // FacilityBlock renders one input + one select per line — mounting all of
  // them for every picklist in the queue (hundreds at once, thousands of
  // lines) is what made this page unusably heavy: 245k+ DOM nodes measured
  // live with 355 open picklists. A closed native <details> only hides
  // content visually; React still mounts it. Deferring the mount until this
  // item has actually been opened once fixes that — and staying mounted
  // afterward (not toggling back off) means a supervisor's in-progress
  // not-found entries survive if the accordion gets collapsed again.
  const [hasOpened, setHasOpened] = useState(false);
  return (
    <details
      className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden"
      onToggle={(e) => {
        if (e.currentTarget.open) setHasOpened(true);
      }}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900">
        <span className="flex items-center gap-1.5 text-sm">
          {queuePos != null && <Tag tone="info">#{queuePos}</Tag>}
          {channel && <PartnerMark name={channel} compact />}
          <b>{f.facility}</b>{" "}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {gatePassNo ? `Gate Pass ${gatePassNo} · ` : ""}{f.no}
          </span>{" "}
          {f.round > 1 && (
            <Tag tone="info">Alternate Picklist — for {primaryFacilityNo(f.no)}</Tag>
          )}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{summary(f)}</span>
      </summary>
      <div className="border-t border-slate-200 p-2.5 dark:border-slate-700">
        {hasOpened && <FacilityBlock f={f} gatePassNo={gatePassNo} />}
      </div>
    </details>
  );
}

function Bucket({
  title,
  tone,
  items,
  channelFor,
  gatePassFor,
  emptyText,
  queued,
}: {
  title: string;
  tone: "warn" | "info" | "ok" | "bad";
  items: FacilityPicklist[];
  channelFor: (f: FacilityPicklist) => string;
  gatePassFor: (f: FacilityPicklist) => string | undefined;
  emptyText: string;
  queued?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div>
        <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {title} <Tag tone={tone}>0</Tag>
        </h3>
        <p className="rounded-lg border border-dashed border-slate-200 p-2.5 text-[11px] text-slate-400 dark:border-slate-700">{emptyText}</p>
      </div>
    );
  }

  const s = bucketSummary(items);

  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
          {title} <Tag tone={tone}>{s.picklistCount}</Tag>
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{s.lineCount} line(s)</span>
          <span>{s.unitCount} units</span>
          <span className="text-emerald-700 dark:text-emerald-400">{s.pickedUnits} picked</span>
          <span className={s.pendingUnits > 0 ? "text-amber-700 dark:text-amber-400" : ""}>{s.pendingUnits} pending</span>
        </span>
      </summary>
      <div className="border-t border-slate-200 p-2.5 dark:border-slate-700">
        {items.map((f, i) => (
          <PicklistItem key={f.no} f={f} channel={channelFor(f)} gatePassNo={gatePassFor(f)} queuePos={queued ? i + 1 : undefined} />
        ))}
      </div>
    </details>
  );
}

// SKU's product name is prefixed with its brand code — "BB", "BW", "MM",
// "LJ", or occasionally the full brand name ("BeBodywise ...") — there's no
// separate brand field in the data model, so this is the only signal for it.
function brandOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface ShortfallRow {
  taskNo: string;
  gatePassNo?: string;
  channel: string;
  sku: string;
  name: string;
  qty: number;
  createdAt: string;
}

function shortfallRows(tasks: PickingTask[]): ShortfallRow[] {
  const rows: ShortfallRow[] = [];
  for (const t of tasks) {
    for (const s of t.shortfall) rows.push({ taskNo: t.no, gatePassNo: t.gatePassNo, channel: t.channel, sku: s.sku, name: s.name, qty: s.qty, createdAt: t.createdAt });
  }
  return rows.sort((a, b) => b.qty - a.qty);
}

function ShortfallAlert() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const rows = useMemo(() => shortfallRows(tasks), [tasks]);
  const [channelFilter, setChannelFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [ageingPreset, setAgeingPreset] = useState<AgeingPreset>("last30");
  const [ageingFrom, setAgeingFrom] = useState("");
  const [ageingTo, setAgeingTo] = useState("");
  if (rows.length === 0) return null;

  const ageingRange = ageingRangeFor(ageingPreset, new Date(), { from: ageingFrom, to: ageingTo });
  const channelOptions = [...new Set(rows.map((r) => r.channel))].sort();
  const brandOptions = [...new Set(rows.map((r) => brandOf(r.name)))].sort();
  const filtered = rows.filter(
    (r) =>
      (!channelFilter || r.channel === channelFilter) &&
      (!brandFilter || brandOf(r.name) === brandFilter) &&
      inAgeingRange(r.createdAt, ageingRange),
  );

  return (
    <details className="mb-4 rounded-lg border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
          ⚠ Critical: stock not available in any facility
        </span>
        <Tag tone="bad">
          {filtered.length} exception{filtered.length === 1 ? "" : "s"}
        </Tag>
      </summary>
      <div className="border-t border-rose-200 p-3 dark:border-rose-800">
        <div className="mb-2 flex flex-wrap gap-2">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="rounded-lg border border-rose-300 bg-white p-1.5 text-xs dark:border-rose-700 dark:bg-slate-900"
          >
            <option value="">All channels</option>
            {channelOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="rounded-lg border border-rose-300 bg-white p-1.5 text-xs dark:border-rose-700 dark:bg-slate-900"
          >
            <option value="">All brands</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="mb-2">
          <AgeingFilter
            preset={ageingPreset}
            onPresetChange={setAgeingPreset}
            from={ageingFrom}
            to={ageingTo}
            onFromChange={setAgeingFrom}
            onToChange={setAgeingTo}
          />
        </div>
        <div className="space-y-1.5">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-rose-700 dark:text-rose-300">No exceptions match this filter.</p>
          ) : (
            filtered.map((r, i) => (
              <div
                key={`${r.taskNo}-${r.sku}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] dark:border-rose-800 dark:bg-slate-900"
              >
                <span className="text-rose-900 dark:text-rose-100">
                  <b>Gate Pass {r.gatePassNo ?? "—"}</b> ({r.channel}): {r.name}
                </span>
                <Tag tone="bad">{r.qty} short</Tag>
              </div>
            ))
          )}
        </div>
      </div>
    </details>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--fefo-line)] bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
      <p className={`mt-1.5 text-3xl font-bold tabular-nums md:text-4xl ${warn ? "text-rose-600 dark:text-rose-400" : "text-[var(--fefo-text)] dark:text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

export function SupervisorQueue() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const facilityPriority = useStore((s) => s.facilityPriority);
  const pickers = useStore((s) => s.pickers);
  const all = supervisorVisibleFacilityLists(tasks); // already in task-creation order; excludes anything still Gate Pass Allocation Pending

  const [facilityFilter, setFacilityFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [pickerFilter, setPickerFilter] = useState("");
  const [ageingPreset, setAgeingPreset] = useState<AgeingPreset>("last30");
  const [ageingFrom, setAgeingFrom] = useState("");
  const [ageingTo, setAgeingTo] = useState("");
  const channelFor = (f: FacilityPicklist) => channelOf(f, tasks);
  const gatePassFor = (f: FacilityPicklist) => gatePassOf(f, tasks);

  const ageingRange = useMemo(
    () => ageingRangeFor(ageingPreset, new Date(), { from: ageingFrom, to: ageingTo }),
    [ageingPreset, ageingFrom, ageingTo],
  );

  const filtered = all.filter((f) => {
    if (facilityFilter && f.facility !== facilityFilter) return false;
    if (channelFilter && channelFor(f) !== channelFilter) return false;
    if (pickerFilter && !f.lines.some((l) => l.picker === pickerFilter)) return false;
    if (!inAgeingRange(createdAtOf(f, tasks), ageingRange)) return false;
    return true;
  });

  const picking = filtered.filter((f) => queueBucket(f) === "picking");
  const blocked = filtered.filter((f) => queueBucket(f) === "blocked");
  const exceptions = filtered.filter((f) => queueBucket(f) === "exception");
  const done = filtered.filter((f) => queueBucket(f) === "done");

  const metrics = useMemo(() => queueMetrics(all), [all]);
  const channelOptions = useMemo(() => [...new Set(tasks.map((t) => t.channel))].sort(), [tasks]);

  if (all.length === 0) {
    return (
      <Card title="Picking queue">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          No picklists yet — waiting on the Planner to raise demand.
        </p>
        <ShortfallAlert />
      </Card>
    );
  }

  return (
    <Card title="Picking queue">
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Metric label="Open picklists" value={String(metrics.openCount)} />
        <Metric label="Stock exceptions" value={String(metrics.exceptionCount)} warn={metrics.exceptionCount > 0} />
        <Metric label="Fill rate" value={metrics.fillRatePct == null ? "—" : `${metrics.fillRatePct}%`} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="">All facilities</option>
          {facilityPriority.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="">All channels</option>
          {channelOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={pickerFilter} onChange={(e) => setPickerFilter(e.target.value)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="">All pickers</option>
          {pickers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <AgeingFilter
          preset={ageingPreset}
          onPresetChange={setAgeingPreset}
          from={ageingFrom}
          to={ageingTo}
          onFromChange={setAgeingFrom}
          onToChange={setAgeingTo}
        />
      </div>

      <div className="space-y-5">
        <Bucket title="Picking Pending" tone="warn" items={picking} channelFor={channelFor} gatePassFor={gatePassFor} queued emptyText="Nothing pending right now." />
        <Bucket title="Gatepass generated — inventory blocked (WMS)" tone="info" items={blocked} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing blocked in WMS right now." />
        <Bucket title="Not found — needs an alternate" tone="bad" items={exceptions} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing with a shortfall right now." />
        <Bucket title="Picking completed" tone="ok" items={done} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing completed yet." />
      </div>

      <div className="mt-5">
        <ShortfallAlert />
      </div>
    </Card>
  );
}
