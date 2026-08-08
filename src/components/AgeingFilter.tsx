import { AGEING_PRESET_LABEL, type AgeingPreset } from "../lib/ageing";

const PRESETS: AgeingPreset[] = ["today", "yesterday", "last7", "last30", "custom"];

export function AgeingFilter({
  preset,
  onPresetChange,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  preset: AgeingPreset;
  onPresetChange: (p: AgeingPreset) => void;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
      {PRESETS.map((p) => (
        <button
          key={p}
          onClick={() => onPresetChange(p)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            preset === p ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {AGEING_PRESET_LABEL[p]}
        </button>
      ))}
      {preset === "custom" && (
        <span className="flex items-center gap-1.5 pl-1 text-xs">
          <input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </span>
      )}
    </div>
  );
}
