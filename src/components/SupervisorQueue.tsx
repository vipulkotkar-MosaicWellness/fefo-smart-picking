import { useMemo, useState } from "react";
import { primaryFacilityNo } from "../lib/format";
import { activeTasks, allFacilityLists, useStore } from "../lib/store";
import { bucketSummary, pickerWorkload, queueBucket, queueMetrics } from "../lib/supervisorMetrics";
import type { FacilityPicklist } from "../lib/types";
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
  return tasks.find((t) => t.no === f.taskNo)?.gatePassNo;
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
  return (
    <details className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden">
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
        <FacilityBlock f={f} gatePassNo={gatePassNo} />
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

function ShortfallAlert() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const withShortfall = tasks.filter((t) => t.shortfall.length > 0);
  if (withShortfall.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/40">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
        Not available in any facility
      </h3>
      {withShortfall.map((t) => (
        <p key={t.no} className="text-[11px] text-rose-800 dark:text-rose-200">
          <b>Gate Pass {t.gatePassNo}</b> ({t.channel}): {t.shortfall.map((s) => `${s.name} — ${s.qty} short`).join(", ")}
        </p>
      ))}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--fefo-line)] bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? "text-rose-600 dark:text-rose-400" : "text-[var(--fefo-text)] dark:text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

export function SupervisorQueue() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const facilityPriority = useStore((s) => s.facilityPriority);
  const pickers = useStore((s) => s.pickers);
  const all = allFacilityLists(tasks); // already in task-creation order

  const [facilityFilter, setFacilityFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [pickerFilter, setPickerFilter] = useState("");
  const channelFor = (f: FacilityPicklist) => channelOf(f, tasks);
  const gatePassFor = (f: FacilityPicklist) => gatePassOf(f, tasks);

  const filtered = all.filter((f) => {
    if (facilityFilter && f.facility !== facilityFilter) return false;
    if (channelFilter && channelFor(f) !== channelFilter) return false;
    if (pickerFilter && !f.lines.some((l) => l.picker === pickerFilter)) return false;
    return true;
  });

  const creation = filtered.filter((f) => queueBucket(f) === "creation");
  const picking = filtered.filter((f) => queueBucket(f) === "picking");
  const exceptions = filtered.filter((f) => queueBucket(f) === "exception");
  const done = filtered.filter((f) => queueBucket(f) === "done");

  const metrics = useMemo(() => queueMetrics(all), [all]);
  const workload = useMemo(() => pickerWorkload(all, pickers), [all, pickers]);
  const channelOptions = useMemo(() => [...new Set(tasks.map((t) => t.channel))].sort(), [tasks]);

  if (all.length === 0) {
    return (
      <Card title="Picking queue">
        <ShortfallAlert />
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          No picklists yet — waiting on the Planner to raise demand.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Picking queue">
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Metric label="Open picklists" value={String(metrics.openCount)} />
        <Metric label="Awaiting assignment" value={String(metrics.unassignedCount)} warn={metrics.unassignedCount > 0} />
        <Metric label="Stock exceptions" value={String(metrics.exceptionCount)} warn={metrics.exceptionCount > 0} />
        <Metric label="Fill rate" value={metrics.fillRatePct == null ? "—" : `${metrics.fillRatePct}%`} />
      </div>

      <ShortfallAlert />

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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-5">
          <Bucket title="Picklist creation pending" tone="warn" items={creation} channelFor={channelFor} gatePassFor={gatePassFor} queued emptyText="Nothing awaiting picker assignment." />
          <Bucket title="Picking pending" tone="info" items={picking} channelFor={channelFor} gatePassFor={gatePassFor} queued emptyText="Nothing currently being picked." />
          <Bucket title="Not found — needs an alternate" tone="bad" items={exceptions} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing with a shortfall right now." />
          <Bucket title="Picking completed" tone="ok" items={done} channelFor={channelFor} gatePassFor={gatePassFor} emptyText="Nothing completed yet." />
        </div>

        <div className="rounded-xl border border-[var(--fefo-line)] p-3 dark:border-slate-700">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Picker workload</h3>
          <div className="space-y-2">
            {workload.map((w) => (
              <div key={w.picker} className="flex items-center justify-between text-xs">
                <span>{w.picker}</span>
                <Tag tone={w.activeLines === 0 ? "ok" : "info"}>{w.activeLines === 0 ? "Available" : `${w.activeLines} active`}</Tag>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
