import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { BUCKET_LABELS, type ChannelBucket } from "../lib/channels";
import { useStore } from "../lib/store";
import { Button, Card } from "./Ui";

export function AdminConfig() {
  const {
    channelRules,
    updateChannelRule,
    addChannel,
    deleteChannel,
    pickers,
    addPicker,
    renamePicker,
    removePicker,
    logAudit,
  } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const isSuperAdmin = useAuth((s) => s.profile?.role === "super_admin");

  const [newName, setNewName] = useState("");
  const [newBucket, setNewBucket] = useState<ChannelBucket>(BUCKET_LABELS[0]);
  const [newRuleType, setNewRuleType] = useState<"fixed" | "pct">("fixed");
  const [newRuleVal, setNewRuleVal] = useState(6);
  const [newMinBinQty, setNewMinBinQty] = useState("");
  const [newPickerName, setNewPickerName] = useState("");
  const [editingPicker, setEditingPicker] = useState<string | null>(null);
  const [editPickerName, setEditPickerName] = useState("");

  function submitNewPicker() {
    const name = newPickerName.trim();
    if (!name) return;
    if (pickers.includes(name)) {
      alert(`"${name}" is already a picker.`);
      return;
    }
    addPicker(name);
    logAudit(myName, `Added picker ${name}`);
    setNewPickerName("");
  }

  function startEditPicker(name: string) {
    setEditingPicker(name);
    setEditPickerName(name);
  }

  async function saveEditPicker() {
    if (!editingPicker) return;
    const name = editPickerName.trim();
    if (!name || name === editingPicker) { setEditingPicker(null); return; }
    if (pickers.includes(name)) {
      alert(`"${name}" is already a picker.`);
      return;
    }
    await renamePicker(editingPicker, name);
    logAudit(myName, `Renamed picker ${editingPicker} to ${name}`);
    setEditingPicker(null);
  }

  function deletePicker(name: string) {
    if (!window.confirm(`Remove ${name} from the picker list? Already-assigned picklists keep their history — this only affects future assignments.`)) return;
    removePicker(name);
    logAudit(myName, `Removed picker ${name}`);
  }

  function setRule(channel: string, rule: Parameters<typeof updateChannelRule>[1]) {
    updateChannelRule(channel, rule);
    logAudit(myName, `Set ${channel} tolerance to ${rule.type === "fixed" ? `${rule.val} fixed months` : `${Math.round(rule.val * 100)}% of shelf life`}`);
  }

  function setMinBinQty(channel: string, raw: string) {
    const n = raw.trim() === "" ? undefined : Math.max(0, Number(raw));
    const r = channelRules[channel];
    updateChannelRule(channel, { ...r, minBinQty: n });
    logAudit(myName, n ? `Set ${channel} min bin qty to ${n}` : `Cleared ${channel} min bin qty (no floor)`);
  }

  function submitNewChannel() {
    const name = newName.trim();
    if (!name) return;
    if (channelRules[name]) {
      alert(`"${name}" already exists — edit it in the table below instead.`);
      return;
    }
    const minBinQty = newMinBinQty.trim() === "" ? undefined : Math.max(0, Number(newMinBinQty));
    const rule = { type: newRuleType, val: newRuleType === "pct" ? newRuleVal / 100 : newRuleVal, minBinQty };
    addChannel(name, newBucket, rule);
    logAudit(myName, `Added channel ${name} (${newBucket}) with tolerance ${newRuleType === "fixed" ? `${newRuleVal} fixed months` : `${newRuleVal}% of shelf life`}${minBinQty ? `, min bin qty ${minBinQty}` : ""}`);
    setNewName("");
    setNewRuleType("fixed");
    setNewRuleVal(6);
    setNewMinBinQty("");
  }

  function removeChannel(name: string) {
    if (!window.confirm(`Delete channel "${name}"? Already-created picklists keep their history — this only stops it being offered for new demand going forward. This can't be undone from here (an Admin would need to re-add it).`)) return;
    deleteChannel(name);
    logAudit(myName, `Deleted channel ${name}`);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Channel dispatch tolerance">
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          Edit the shelf-life rule per channel. <b>Fixed</b> = months remaining; <b>% of shelf</b> = fraction of
          total shelf life remaining. Applies to the next picking task.
          {isSuperAdmin && " Super Admin can delete a channel — existing picklists keep their history, it just stops being offered for new demand."}
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
          <label className="text-[11px]">
            <span className="block text-slate-500 dark:text-slate-400">Min bin qty (optional)</span>
            <input
              type="number"
              min={0}
              value={newMinBinQty}
              onChange={(e) => setNewMinBinQty(e.target.value)}
              placeholder="none"
              className="mt-0.5 w-20 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
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
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Min bin qty</th>
                {isSuperAdmin && <th className="border-b border-slate-200 p-1.5 dark:border-slate-700"></th>}
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
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      <input
                        type="number"
                        min={0}
                        value={r.minBinQty ?? ""}
                        onChange={(e) => setMinBinQty(c, e.target.value)}
                        placeholder="none"
                        title="Only offer a bin+batch to this channel if its available qty is at least this much. Blank = no floor."
                        className="w-16 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                      />
                    </td>
                    {isSuperAdmin && (
                      <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                        <Button variant="sm" onClick={() => removeChannel(c)}>Delete</Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Pickers">
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            Names available in the "Assign to" dropdown, the picker workload panel, and printed picklists. Renaming
            updates every not-yet-picked assignment already made to that name.
          </p>

          <div className="mb-2 flex gap-1.5">
            <input
              value={newPickerName}
              onChange={(e) => setNewPickerName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewPicker(); }}
              placeholder="New picker name"
              className="min-w-32 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            />
            <Button variant="sm" onClick={submitNewPicker}>Add picker</Button>
          </div>

          <div className="space-y-1.5">
            {pickers.map((p) => (
              <div key={p} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                {editingPicker === p ? (
                  <>
                    <input
                      value={editPickerName}
                      onChange={(e) => setEditPickerName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveEditPicker(); }}
                      autoFocus
                      className="mr-2 flex-1 rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                    />
                    <span className="flex gap-1">
                      <Button variant="sm" onClick={() => void saveEditPicker()}>Save</Button>
                      <Button variant="sm" onClick={() => setEditingPicker(null)}>Cancel</Button>
                    </span>
                  </>
                ) : (
                  <>
                    <span>{p}</span>
                    <span className="flex gap-1">
                      <Button variant="sm" onClick={() => startEditPicker(p)}>Rename</Button>
                      <Button variant="sm" onClick={() => deletePicker(p)}>Remove</Button>
                    </span>
                  </>
                )}
              </div>
            ))}
            {pickers.length === 0 && <p className="text-[11px] text-slate-400">No pickers yet — add one above.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
