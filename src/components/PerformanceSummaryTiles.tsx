import { taskIsComplete } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { Card } from "./Ui";

export function PerformanceSummaryTiles({ tasks, onViewReport }: { tasks: PickingTask[]; onViewReport: () => void }) {
  const done = tasks.filter(taskIsComplete);

  let td = 0;
  let ts = 0;
  done.forEach((t) => {
    t.demand.forEach((d) => (td += d.qty));
    t.facilities.forEach((f) => f.lines.forEach((l) => (ts += l.picked ?? 0)));
  });
  const fill = td ? Math.round((ts / td) * 100) : 0;

  return (
    <Card title="Sold / performance">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Completed tasks</p>
          <p className="mt-1 text-xl font-bold text-[var(--fefo-text)] dark:text-slate-100">{done.length}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Overall fill rate</p>
          <p className="mt-1 text-xl font-bold text-[var(--fefo-text)] dark:text-slate-100">{fill}%</p>
        </div>
      </div>
      <button
        onClick={onViewReport}
        className="mt-3 text-[11px] font-semibold text-[var(--fefo-teal-700)] hover:underline dark:text-teal-300"
      >
        View full fill rate report →
      </button>
    </Card>
  );
}
