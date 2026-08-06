import { useState } from "react";
import { BUCKET_LABEL, bucketFor, type Bucket } from "../lib/dateRanges";
import { downloadCsv, primaryFacilityNo } from "../lib/format";
import { allFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist } from "../lib/types";
import { gatePassBulkCsv, uniwareCsv } from "../lib/uniwareExport";
import { Button, Card, Tag } from "./Ui";

const BUCKET_ORDER: Bucket[] = ["today", "yesterday", "last30", "older"];

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function PicklistRepository() {
  const tasks = useStore((s) => s.tasks);
  const all = allFacilityLists(tasks);
  const now = new Date();
  const [active, setActive] = useState<Bucket>("today");

  const taskByNo = new Map(tasks.map((t) => [t.no, t]));
  const groups = new Map<Bucket, { task: string; facility: FacilityPicklist }[]>();
  for (const t of tasks) {
    const bucket = bucketFor(t.createdAt, now);
    for (const f of t.facilities) {
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket)!.push({ task: t.no, facility: f });
    }
  }

  if (all.length === 0) {
    return (
      <Card title="Picklist repository">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No picklists generated yet.</p>
      </Card>
    );
  }

  const rows = groups.get(active) ?? [];

  return (
    <Card title="Picklist repository">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          {BUCKET_ORDER.map((bucket) => (
            <button
              key={bucket}
              onClick={() => setActive(bucket)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                active === bucket ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {BUCKET_LABEL[bucket]} <span className="opacity-70">({(groups.get(bucket) ?? []).length})</span>
            </button>
          ))}
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="sm"
              onClick={() =>
                downloadCsv(
                  gatePassBulkCsv(rows.map((r) => ({ gatePassNo: taskByNo.get(r.task)?.gatePassNo ?? r.task, lines: r.facility.lines }))),
                  `gate_pass_bulk_${active}.csv`,
                )
              }
            >
              Bulk Gate Pass CSV
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Nothing in {BUCKET_LABEL[active].toLowerCase()}.</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Gate Pass</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Task</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Facility Picklist</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Facility</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Generated</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Lines</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">Status</th>
              <th className="border-b border-slate-100 p-1.5 dark:border-slate-700/60"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ task, facility: f }) => {
              const t = taskByNo.get(task);
              return (
                <tr key={f.no} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{t?.gatePassNo ?? "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {task}
                    {f.round > 1 && (
                      <div className="mt-0.5">
                        <Tag tone="info">Alternate Picklist — for {primaryFacilityNo(f.no)}</Tag>
                      </div>
                    )}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.no}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.facility}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {t && (
                      <>
                        {timeLabel(t.createdAt)}
                        {t.createdByName && <div className="text-[10px] text-slate-500 dark:text-slate-400">by {t.createdByName}</div>}
                      </>
                    )}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{f.lines.length}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    <Tag tone={f.status === "completed" ? "ok" : "warn"}>{f.status}</Tag>
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    <Button variant="sm" onClick={() => downloadCsv(uniwareCsv(f.lines, t?.gatePassNo || f.no), `${t?.gatePassNo || f.no}.csv`)}>CSV</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
