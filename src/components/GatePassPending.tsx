import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { FACILITY_GATE_PASS_PREFIX } from "../lib/facilities";
import { pendingGatePassFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist } from "../lib/types";
import { PartnerMark } from "./partners/PartnerMark";
import { Button, Card, Tag } from "./Ui";

/**
 * Facility picklists that are fully allocated (bins, batches, quantities all
 * decided) but held back from the Picking Supervisor queue because no gate
 * pass number has been matched to them yet. Lives on the Demand Planner side
 * on purpose — until a valid, facility-matching gate pass is entered here, a
 * Supervisor can't see it at all, so they can't print or assign a picker.
 */
export function GatePassPending() {
  const tasks = useStore((s) => s.tasks);
  const setFacilityGatePass = useStore((s) => s.setFacilityGatePass);
  const discardFacilityPicklist = useStore((s) => s.discardFacilityPicklist);
  const logAudit = useStore((s) => s.logAudit);
  const myName = useAuth((s) => s.profile?.display_name ?? "Planner");

  const pending = pendingGatePassFacilityLists(tasks);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyNo, setBusyNo] = useState<string | null>(null);

  function taskOf(f: FacilityPicklist) {
    return tasks.find((t) => t.no === f.taskNo);
  }

  async function submit(f: FacilityPicklist) {
    const value = (inputs[f.no] ?? "").trim();
    if (!value) {
      setErrors((e) => ({ ...e, [f.no]: "Enter a gate pass number." }));
      return;
    }
    setBusyNo(f.no);
    try {
      const result = await setFacilityGatePass(f.taskNo, f.no, value);
      if (!result.ok) {
        setErrors((e) => ({ ...e, [f.no]: result.error ?? "Could not save." }));
        return;
      }
      setErrors((e) => { const next = { ...e }; delete next[f.no]; return next; });
      setInputs((i) => { const next = { ...i }; delete next[f.no]; return next; });
      logAudit(myName, `Set gate pass ${value} for ${f.no} at ${f.facility}`);
    } finally {
      setBusyNo(null);
    }
  }

  async function discard(f: FacilityPicklist) {
    if (!window.confirm(`Discard ${f.no} at ${f.facility}? Its reserved stock is freed, nothing is deleted, and it can be restored from Admin → Discarded picklists.`)) return;
    await discardFacilityPicklist(f.taskNo, f.no);
    logAudit(myName, `Discarded picklist ${f.no} at ${f.facility} while awaiting gate pass`);
  }

  if (pending.length === 0) {
    return (
      <Card title="Gate pass allocation pending">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Nothing waiting on a gate pass right now.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Gate pass allocation pending (${pending.length})`}>
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        Fully allocated, but not yet visible to the Picking Supervisor — a Supervisor can't print or assign a picker
        for these until a gate pass number is entered here. Each facility needs its own gate pass, matching its
        prefix: SL Ambient → {FACILITY_GATE_PASS_PREFIX["SL Ambient"]}…, SL Mother Hub → {FACILITY_GATE_PASS_PREFIX["SL Mother Hub"]}…,
        SL RX → {FACILITY_GATE_PASS_PREFIX["SL RX"]}…
      </p>
      <div className="space-y-2">
        {pending.map((f) => {
          const task = taskOf(f);
          const qty = f.lines.reduce((s, l) => s + l.qty, 0);
          return (
            <div key={f.no} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs">
                  {task && <PartnerMark name={task.channel} compact />}
                  <b>{f.facility}</b>
                  <span className="text-slate-500 dark:text-slate-400">{f.no}</span>
                  <Tag tone="warn">{f.lines.length} line(s) · {qty} units</Tag>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={inputs[f.no] ?? ""}
                  onChange={(e) => setInputs((i) => ({ ...i, [f.no]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void submit(f); }}
                  placeholder={`${FACILITY_GATE_PASS_PREFIX[f.facility] ?? "GP"}...`}
                  className="min-w-40 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                />
                <Button variant="sm" onClick={() => void submit(f)} disabled={busyNo === f.no}>
                  {busyNo === f.no ? "Saving…" : "Validate & Release"}
                </Button>
                <Button variant="sm" onClick={() => void discard(f)}>
                  Discard
                </Button>
              </div>
              {errors[f.no] && <p className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">{errors[f.no]}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
