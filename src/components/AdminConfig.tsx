import { useAuth } from "../lib/authStore";
import { useStore } from "../lib/store";
import { Button, Card } from "./Ui";

export function AdminConfig() {
  const { channelRules, updateChannelRule, facilityPriority, setFacilityPriority, logAudit } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");

  function setRule(channel: string, rule: Parameters<typeof updateChannelRule>[1]) {
    updateChannelRule(channel, rule);
    logAudit(myName, `Set ${channel} tolerance to ${rule.type === "fixed" ? `${rule.val} fixed months` : `${Math.round(rule.val * 100)}% of shelf life`}`);
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
