import { useState } from "react";
import { BUCKET_LABEL, bucketFor, type Bucket } from "../lib/dateRanges";
import { activeTasks, useStore } from "../lib/store";
import { NotFoundSummary } from "./NotFoundSummary";
import { OverallReport } from "./OverallReport";
import { PicklistRepository } from "./PicklistRepository";

const BUCKET_ORDER: Bucket[] = ["today", "yesterday", "last30", "older"];
type ReportTab = "notfound" | "overall" | "repository";

const TABS: { id: ReportTab; label: string }[] = [
  { id: "notfound", label: "Not-Found Summary" },
  { id: "overall", label: "Overall Report" },
  { id: "repository", label: "Picklist Repository" },
];

export function Reports() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const now = new Date();
  const [tab, setTab] = useState<ReportTab>("notfound");
  const [bucket, setBucket] = useState<Bucket>("today");

  const bucketed = tasks.map((t) => ({ task: t, bucket: bucketFor(t.createdAt, now) }));
  const counts = new Map<Bucket, number>();
  for (const { bucket: b } of bucketed) counts.set(b, (counts.get(b) ?? 0) + 1);
  const filtered = bucketed.filter((x) => x.bucket === bucket).map((x) => x.task);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
        {BUCKET_ORDER.map((b) => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              bucket === b ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {BUCKET_LABEL[b]} <span className="opacity-70">({counts.get(b) ?? 0})</span>
          </button>
        ))}
      </div>

      {tab === "notfound" && <NotFoundSummary tasks={filtered} />}
      {tab === "overall" && <OverallReport tasks={filtered} />}
      {tab === "repository" && <PicklistRepository tasks={filtered} />}
    </div>
  );
}
