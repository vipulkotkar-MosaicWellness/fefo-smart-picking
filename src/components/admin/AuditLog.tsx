import { useStore } from "../../lib/store";
import { Card } from "../Ui";

export function AuditLog() {
  const entries = useStore((s) => s.auditLog);
  return (
    <Card title="Recent activity">
      {entries.length === 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">No admin changes recorded in this browser yet.</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {entries.map((e, i) => (
            <p key={i} className="border-b border-slate-100 pb-1.5 text-[11px] text-slate-600 last:border-0 dark:border-slate-700/60 dark:text-slate-300">
              <b>{e.by}</b> {e.action}
              <br />
              <span className="text-[10px] text-slate-400">{new Date(e.at).toLocaleString()}</span>
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-400">Recorded in this browser only — not yet synced across devices.</p>
    </Card>
  );
}
