import { useEffect } from "react";
import { AdminConfig } from "./components/AdminConfig";
import { DemandPanel } from "./components/DemandPanel";
import { InventoryPanel } from "./components/InventoryPanel";
import { PerformancePanel } from "./components/PerformancePanel";
import { PickerView } from "./components/PickerView";
import { SupervisorQueue } from "./components/SupervisorQueue";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { useStore } from "./lib/store";
import type { Role } from "./lib/types";

const ROLES: { key: Role; label: string }[] = [
  { key: "admin", label: "Admin" },
  { key: "planner", label: "Planner" },
  { key: "supervisor", label: "Supervisor" },
  { key: "picker", label: "Picker" },
];

export default function App() {
  const {
    locations, visibleFacilities, toggleFacility, anyOpen, tasks, lastSync, syncStock, syncing, notice,
    role, setRole, pickers, currentPicker, setCurrentPicker, loadFromSupabase,
  } = useStore();

  // On load, pull live stock from Supabase (if configured); else the app keeps the snapshot.
  useEffect(() => {
    void loadFromSupabase();
  }, [loadFromSupabase]);
  const openNos = tasks.filter((t) => t.facilities.some((f) => f.lines.some((l) => l.picked == null))).map((t) => t.no).join(", ");
  const ops = role !== "picker";
  const syncLabel = new Date(lastSync).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-full bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-6xl p-4">
        <header className="rounded-xl bg-gradient-to-br from-teal-700 to-teal-900 p-5 text-white shadow">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">FEFO Smart Picking</h1>
              <p className="text-xs opacity-90">Multi-facility waterfall · picking tasks · picker assignment · round-2</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">
                {isSupabaseConfigured ? "Supabase connected" : "Local mode (browser)"}
              </span>
              <div className="inline-flex flex-wrap gap-1 rounded-lg bg-white/15 p-1">
                {ROLES.map((r) => (
                  <button key={r.key} onClick={() => setRole(r.key)} className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${role === r.key ? "bg-white text-teal-900" : "text-white"}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {ops && (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold opacity-90">Show inventory:</span>
                {locations().map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={visibleFacilities.includes(f)} onChange={() => toggleFacility(f)} className="h-3.5 w-3.5 accent-white" />
                    {f}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-90">Stock synced from email · <b>{syncLabel}</b></span>
                <button
                  onClick={syncStock}
                  disabled={syncing}
                  className="rounded-md bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
            </div>
          )}

          {ops && notice && (
            <div
              className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                notice.startsWith("✗")
                  ? "bg-rose-100 text-rose-900"
                  : notice.startsWith("⚠")
                    ? "bg-amber-100 text-amber-900"
                    : "bg-white/15 text-white"
              }`}
            >
              {notice}
            </div>
          )}

          {role === "picker" && (
            <div className="mt-3">
              <label className="text-xs opacity-90">
                <span className="mb-1 mr-2 font-semibold">You are picker</span>
                <select value={currentPicker} onChange={(e) => setCurrentPicker(e.target.value)} className="min-w-40 rounded-lg border-0 bg-white p-2 text-sm text-slate-900">
                  {pickers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          )}

          {ops && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${anyOpen() ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
              {anyOpen() ? (
                <>⚠ Inventory feed <b>FROZEN</b> — open task(s): {openNos}. New stock will not load from the email until all picking is complete.</>
              ) : (
                <>Inventory feed <b>live</b> — stock refreshes from the auto-generated email.</>
              )}
            </div>
          )}
        </header>

        {role === "admin" && <div className="mt-4 space-y-4"><AdminConfig /><InventoryPanel /></div>}
        {role === "planner" && (
          <div className="mt-4 space-y-4">
            <DemandPanel />
            <PerformancePanel />
            <InventoryPanel />
          </div>
        )}
        {role === "supervisor" && (
          <div className="mt-4 space-y-4">
            <SupervisorQueue />
            <InventoryPanel />
          </div>
        )}
        {role === "picker" && <div className="mt-4"><PickerView /></div>}

        <p className="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">FEFO Smart Picking · React + Supabase-ready · Mosaic Wellness</p>
      </div>
    </div>
  );
}
