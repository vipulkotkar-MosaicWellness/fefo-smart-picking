import { allFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist } from "../lib/types";
import { Card, Tag } from "./Ui";
import { FacilityBlock } from "./FacilityBlock";

function bucketOf(f: FacilityPicklist): "creation" | "picking" | "done" {
  if (f.status === "completed") return "done";
  return f.lines.some((l) => l.picker) ? "picking" : "creation";
}

function summary(f: FacilityPicklist) {
  const qty = f.lines.reduce((s, l) => s + l.qty, 0);
  const assigned = f.lines.filter((l) => l.picker).length;
  return `${f.lines.length} line(s) · ${qty} units${assigned ? ` · ${assigned}/${f.lines.length} assigned` : ""}`;
}

function PicklistItem({ f, queuePos }: { f: FacilityPicklist; queuePos?: number }) {
  return (
    <details className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900">
        <span className="text-sm">
          {queuePos != null && <Tag tone="info">#{queuePos}</Tag>}{" "}
          <b>{f.facility}</b> <span className="text-xs text-slate-500 dark:text-slate-400">{f.no}</span>{" "}
          {f.round > 1 && <Tag tone="info">Round {f.round}</Tag>}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{summary(f)}</span>
      </summary>
      <div className="border-t border-slate-200 p-2.5 dark:border-slate-700">
        <FacilityBlock f={f} />
      </div>
    </details>
  );
}

function Bucket({
  title,
  tone,
  items,
  emptyText,
  queued,
}: {
  title: string;
  tone: "warn" | "info" | "ok";
  items: FacilityPicklist[];
  emptyText: string;
  queued?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title} <Tag tone={tone}>{items.length}</Tag>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-2.5 text-[11px] text-slate-400 dark:border-slate-700">{emptyText}</p>
      ) : (
        items.map((f, i) => <PicklistItem key={f.no} f={f} queuePos={queued ? i + 1 : undefined} />)
      )}
    </div>
  );
}

export function SupervisorQueue() {
  const tasks = useStore((s) => s.tasks);
  const all = allFacilityLists(tasks); // already in task-creation order

  const creation = all.filter((f) => bucketOf(f) === "creation");
  const picking = all.filter((f) => bucketOf(f) === "picking");
  const done = all.filter((f) => bucketOf(f) === "done");

  if (all.length === 0) {
    return (
      <Card title="Picking queue">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          No picklists yet — waiting on the Planner to raise demand.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Picking queue">
      <div className="space-y-5">
        <Bucket title="Picklist creation pending" tone="warn" items={creation} queued emptyText="Nothing awaiting picker assignment." />
        <Bucket title="Picking pending" tone="info" items={picking} queued emptyText="Nothing currently being picked." />
        <Bucket title="Picking completed" tone="ok" items={done} emptyText="Nothing completed yet." />
      </div>
    </Card>
  );
}
