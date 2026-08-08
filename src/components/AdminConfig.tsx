import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { BUCKET_LABELS, type ChannelBucket } from "../lib/channels";
import { useStore } from "../lib/store";
import { Button, Card } from "./Ui";

export function AdminConfig() {
  const { channelRules, updateChannelRule, addChannel, facilityPriority, setFacilityPriority, logAudit } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");

  const [newName, setNewName] = useState("");
  const [newBucket, setNewBucket] = useState<ChannelBucket>(BUCKET_LABELS[0]);
  const [newRuleType, setNewRuleType] = useState<"fixed" | "pct">("fixed");
  const [newRuleVal, setNewRuleVal] = useState(6);

  function setRule(channel: string, rule: Parameters<typeof updateChannelRule>[1]) {
    updateChannelRule(channel, rule);
    logAudit(myName, `Set ${channel} tolerance to ${rule.type === "fixed" ? `${rule.val} fixed months` : `${Math.round(rule.val * 100)}% of shelf life`}`);
  }

  function submitNewChannel() {
    const name = newName.trim();
    if (!name) return;
    if (channelRules[name]) {
      alert(`"${name}" already exists — edit it in the table below instead.`);
      return;
    }
    const rule = { type: newRuleType, val: newRuleType === "pct" ? newRuleVal / 100 : newRuleVal };
    addChannel(name, newBucket, rule);
    logAudit(myName, `Added channel ${name} (${newBucket}) with tolerance ${newRuleType === "fixed" ? `${newRuleVal} fixed months` : `${newRuleVal}% of shelf life`}`);
    setNewName("");
    setNewRuleType("fixed");
    setNewRuleVal(6);
  }

  function move(i: number, dir: -1 | 1) {
    const p = [...facilityPriority];
    const j = i + dir;
    if (j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]];
    setFacilityPriority(p);
    logAudit(myName, `Reordered facility waterfall: ${p.join(" → ")}`);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Channel dispatch tolerance">
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          Edit the shelf-life rule per channel. <b>Fixed</b> = months remaining; <b>% of shelf</b> = fraction of
          total shelf life remaining. Applies to the next picking task.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900">
          <label className="text-[11px]">
            <span className="block text-slate-500 dark:text-slate-400">New channel name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Croma"
              className="mt-0.5 w-36 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="text-[11px]">
            <span className="block text-slate-500 dark:text-slate-400">Channel bucket</span>
            <select
              value={newBucket}
              onChange={(e) => setNewBucket(e.target.value as ChannelBucket)}
              className="mt-0.5 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            >
              {BUCKET_LABELS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px]">
            <span className="block text-slate-500 dark:text-slate-400">Rule</span>
            <select
              value={newRuleType}
              onChange={(e) => setNewRuleType(e.target.value as "fixed" | "pct")}
              className="mt-0.5 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="fixed">Fixed months</option>
              <option value="pct">% of shelf</option>
            </select>
          </label>
          <label className="text-[11px]">
            <span className="block text-slate-500 dark:text-slate-400">Value</span>
            <input
              type="number"
              min={0}
              max={newRuleType === "pct" ? 100 : undefined}
              value={newRuleVal}
              onChange={(e) => setNewRuleVal(Number(e.target.value))}
              className="mt-0.5 w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <Button variant="sm" onClick={submitNewChannel}>Add channel</Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Channel</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Rule</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(channelRules).map((c) => {
                const r = channelRules[c];
                return (
                  <tr key={c} className="text-slate-700 dark:text-slate-200">
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{c}</td>
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      <select
                        value={r.type}
                        onChange={(e) =>
                          setRule(c, {
                            type: e.target.value as "fixed" | "pct",
                            val: e.target.value === "pct" ? 0.75 : 6,
                          })
                        }
                        className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="fixed">Fixed months</option>
                        <option value="pct">% of shelf</option>
                      </select>
                    </td>
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      {r.type === "fixed" ? (
                        <input
                          type="number"
                          min={0}
                          value={r.val}
                          onChange={(e) => setRule(c, { type: "fixed", val: Number(e.target.value) })}
                          className="w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(r.val * 100)}
                            onChange={(e) =>
                              setRule(c, { type: "pct", val: Number(e.target.value) / 100 })
                            }
                            className="w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                          />
                          %
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Facility priority (waterfall order)">
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            Demand fills from top to bottom.
          </p>
          <div className="space-y-1.5">
            {facilityPriority.map((f, i) => (
              <div
                key={f}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <span>
                  <b>{i + 1}.</b> {f}
                </span>
                <span className="flex gap-1">
                  <Button variant="sm" onClick={() => move(i, -1)}>↑</Button>
                  <Button variant="sm" onClick={() => move(i, 1)}>↓</Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
