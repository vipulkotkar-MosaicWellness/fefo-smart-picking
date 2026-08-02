import { allFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist } from "../lib/types";
import { downloadCsv } from "../lib/format";
import { uniwareCsv } from "../lib/uniwareExport";
import { Button, Card, Tag } from "./Ui";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function combinedCsv(lists: FacilityPicklist[]): string {
  return uniwareCsv(lists.flatMap((f) => f.lines));
}

export function PicklistRepository() {
  const tasks = useStore((s) => s.tasks);
  const all = allFacilityLists(tasks);

  const groups = new Map<string, { task: string; facility: FacilityPicklist }[]>();
  for (const t of tasks) {
    for (const f of t.facilities) {
      const day = dayKey(t.createdAt);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push({ task: t.no, facility: f });
    }
  }
  // Most-recent-day-first, derived from each task's actual timestamp (not the label text).
  const sortedDays = [...tasks]
    .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())
    .map((t) => dayKey(t.createdAt))
    .filter((d, i, arr) => arr.indexOf(d) === i);

  if (all.length === 0) {
    return (
      <Card title="Picklist repository">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No picklists generated yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Picklist repository — day-wise">
      <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        Every picklist ever generated, grouped by the day it was created. Downloads use the Uniware import format.
      </p>
      <div className="space-y-4">
        {sortedDays.map((day) => {
          const rows = groups.get(day) ?? [];
          return (
            <div key={day} className="rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <span className="text-sm font-semibold">{day}</span>
                <div className="flex items-center gap-2">
                  <Tag tone="muted">{rows.length} picklist(s)</Tag>
                  <Button variant="sm" onClick={() => downloadCsv(combinedCsv(rows.map((r) => r.facility)), `picklists_${day.replace(/[, ]+/g, "_")}.csv`)}>
                    Download all for this day
                  </Button>
                </div>
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Task</th>
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Facility Picklist</th>
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Facility</th>
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Lines</th>
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Status</th>
                    <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ task, facility: f }) => (
                    <tr key={f.no} className="text-slate-700 dark:text-slate-200">
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{task}</td>
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.no}</td>
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.facility}</td>
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.lines.length}</td>
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                        <Tag tone={f.status === "completed" ? "ok" : "warn"}>{f.status}</Tag>
                      </td>
                      <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                        <Button variant="sm" onClick={() => downloadCsv(uniwareCsv(f.lines), `${f.no}.csv`)}>CSV</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
