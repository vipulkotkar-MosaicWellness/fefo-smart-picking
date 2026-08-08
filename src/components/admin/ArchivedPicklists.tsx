import { useState } from "react";
import { useAuth } from "../../lib/authStore";
import { activeTasks, useStore } from "../../lib/store";
import { Button, Card, Tag } from "../Ui";

export function ArchivedPicklists() {
  const tasks = useStore((s) => s.tasks);
  const { archiveAllActiveTasks, archiveByCutoff, unarchiveTask, unarchiveAllTasks, logAudit } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const [cutoffDate, setCutoffDate] = useState("");

  const archived = tasks.filter((t) => t.archived);
  const activeCount = activeTasks(tasks).length;

  async function archiveAll() {
    if (activeCount === 0) return;
    if (!window.confirm(`Archive all ${activeCount} active picklist(s)? They'll disappear from every screen and report, and free up their reserved stock — but nothing is deleted, and you can bring any of them back below.`)) {
      return;
    }
    await archiveAllActiveTasks();
    logAudit(myName, `Archived all ${activeCount} active picklist(s) to start fresh`);
  }

  async function archiveDirection(direction: "before" | "after") {
    if (!cutoffDate) return;
    const label = direction === "before" ? `before ${cutoffDate}` : `${cutoffDate} onward`;
    if (!window.confirm(`Archive every active picklist ${label}?`)) return;
    const count = await archiveByCutoff(cutoffDate, direction);
    if (count > 0) logAudit(myName, `Archived ${count} picklist(s) ${label}`);
    else alert(`Nothing matched ${label}.`);
  }

  async function restore(taskNo: string) {
    await unarchiveTask(taskNo);
    logAudit(myName, `Unarchived picklist ${taskNo}`);
  }

  async function restoreAll() {
    if (archived.length === 0) return;
    if (!window.confirm(`Unarchive all ${archived.length} picklist(s)? They'll return to every operational screen and report, and reserve stock again.`)) {
      return;
    }
    await unarchiveAllTasks();
    logAudit(myName, `Unarchived all ${archived.length} picklist(s)`);
  }

  return (
    <Card title="Archived picklists">
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        Archiving hides a picklist from Picking Supervisor, Picklist Repository, and both reports, and frees the
        stock it was reserving — without deleting anything. Use this instead of asking for a database delete when
        you want a clean slate for testing.
      </p>

      <Button variant="ghost" onClick={() => void archiveAll()} disabled={activeCount === 0}>
        Archive all {activeCount} active picklist{activeCount === 1 ? "" : "s"}
      </Button>

      <div className="mt-3 flex flex-wrap items-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900">
        <label className="text-[11px]">
          <span className="block text-slate-500 dark:text-slate-400">Or archive by date</span>
          <input
            type="date"
            value={cutoffDate}
            onChange={(e) => setCutoffDate(e.target.value)}
            className="mt-0.5 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <Button variant="sm" onClick={() => void archiveDirection("before")} disabled={!cutoffDate}>
          Archive everything before this date
        </Button>
        <Button variant="sm" onClick={() => void archiveDirection("after")} disabled={!cutoffDate}>
          Archive this date onward
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Currently archived ({archived.length})
          </p>
          {archived.length > 0 && (
            <Button variant="sm" onClick={() => void restoreAll()}>Unarchive all {archived.length}</Button>
          )}
        </div>
        {archived.length === 0 ? (
          <p className="text-[11px] text-slate-400">Nothing archived right now.</p>
        ) : (
          <div className="space-y-1.5">
            {archived.map((t) => (
              <div key={t.no} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                <span>
                  <b>{t.gatePassNo}</b> <span className="text-slate-500 dark:text-slate-400">{t.no} · {t.channel}</span>{" "}
                  <Tag tone="muted">{t.facilities.length} facility picklist(s)</Tag>
                </span>
                <Button variant="sm" onClick={() => void restore(t.no)}>Unarchive</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
