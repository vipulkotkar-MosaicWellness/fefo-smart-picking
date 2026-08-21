import { useAuth } from "../../lib/authStore";
import { effectiveGatePassNo, useStore } from "../../lib/store";
import { Button, Card, Tag } from "../Ui";

/**
 * A separate feature and a separate screen from Archived Picklists: discarding
 * cancels one specific facility picklist (only while it was still open) and
 * frees its reserved stock, rather than hiding a whole gate pass regardless
 * of pick status. Never merge this list with the archived-tasks one.
 */
export function DiscardedPicklists() {
  const tasks = useStore((s) => s.tasks);
  const undiscardFacilityPicklist = useStore((s) => s.undiscardFacilityPicklist);
  const logAudit = useStore((s) => s.logAudit);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");

  const discarded = tasks.flatMap((t) => t.facilities.filter((f) => f.discarded).map((f) => ({ task: t, f })));

  async function restore(taskNo: string, facilityNo: string, gatePassNo: string | undefined, facility: string) {
    await undiscardFacilityPicklist(taskNo, facilityNo);
    logAudit(myName, `Restored discarded picklist ${facilityNo} (${gatePassNo ?? "gate pass pending"}, ${facility})`);
  }

  return (
    <Card title="Discarded picklists">
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        Discarding cancels one specific facility picklist while it's still open and frees the stock it was
        reserving — nothing is deleted, and it can be restored below. This is separate from Archived Picklists,
        which hides a whole gate pass regardless of pick status.
      </p>
      {discarded.length === 0 ? (
        <p className="text-[11px] text-slate-400">Nothing discarded right now.</p>
      ) : (
        <div className="space-y-1.5">
          {discarded.map(({ task, f }) => (
            <div key={f.no} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
              <span>
                <b>{effectiveGatePassNo(f, task) ?? "Gate pass pending"}</b>{" "}
                <span className="text-slate-500 dark:text-slate-400">{f.no} · {f.facility}</span>{" "}
                <Tag tone="muted">Round {f.round}</Tag>
              </span>
              <Button variant="sm" onClick={() => void restore(task.no, f.no, effectiveGatePassNo(f, task), f.facility)}>
                Undo discard
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
