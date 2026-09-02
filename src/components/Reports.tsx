import { useState } from "react";
import { ageingRangeFor, inAgeingRange, type AgeingPreset } from "../lib/ageing";
import { activeTasks, useStore } from "../lib/store";
import { AgeingFilter } from "./AgeingFilter";
import { BinSkipReport } from "./BinSkipReport";
import { DetailedReport } from "./DetailedReport";
import { FillRateReport } from "./FillRateReport";
import { NotFoundSummary } from "./NotFoundSummary";
import { OverallReport } from "./OverallReport";
import { PicklistRepository } from "./PicklistRepository";

type ReportTab = "notfound" | "overall" | "detailed" | "repository" | "binskips" | "fillrate";

const TABS: { id: ReportTab; label: string }[] = [
  { id: "notfound", label: "Not-Found Summary" },
  { id: "overall", label: "Overall Report" },
  { id: "detailed", label: "Overall Report — Detailed" },
  { id: "repository", label: "Picklist Repository" },
  { id: "binskips", label: "Bin Skip Report" },
  { id: "fillrate", label: "Fill Rate" },
];

export function Reports() {
  const tasks = activeTasks(useStore((s) => s.tasks));
  const now = new Date();
  const [tab, setTab] = useState<ReportTab>("notfound");
  const [preset, setPreset] = useState<AgeingPreset>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const range = ageingRangeFor(preset, now, { from, to });
  const filtered = tasks.filter((t) => inAgeingRange(t.createdAt, range));

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

      <AgeingFilter preset={preset} onPresetChange={setPreset} from={from} to={to} onFromChange={setFrom} onToChange={setTo} />

      {tab === "notfound" && <NotFoundSummary tasks={filtered} />}
      {tab === "overall" && <OverallReport tasks={filtered} />}
      {tab === "detailed" && <DetailedReport tasks={filtered} />}
      {tab === "repository" && <PicklistRepository tasks={filtered} />}
      {tab === "binskips" && <BinSkipReport tasks={filtered} />}
      {tab === "fillrate" && <FillRateReport tasks={filtered} />}
    </div>
  );
}
