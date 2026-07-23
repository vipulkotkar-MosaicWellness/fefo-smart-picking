import { AdminConfig } from "./components/AdminConfig";
import { DemandPanel } from "./components/DemandPanel";
import { PerformancePanel } from "./components/PerformancePanel";
import { PickerView } from "./components/PickerView";
import { RegisterPanel } from "./components/RegisterPanel";
import { StockPanel } from "./components/StockPanel";
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
    location, setLocation, locations, phase, setPhase, anyOpen, tasks,
    role, setRole, pickers, currentPicker, setCurrentPicker,
  } = useStore();
  const source = phase === 1 ? "Daily auto-generated email" : "API (real-time)";
  const openNos = tasks.filter((t) => t.facilities.some((f) => f.lines.some((l) => l.picked == null))).map((t) => t.no).join(", ");
  const showOps = role === "admin" || role === "supervisor";
  const showFreeze = role !== "picker";

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
                  <button
                    key={r.key}
                    onClick={() => setRole(r.key)}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${role === r.key ? "bg-white text-teal-900" : "text-white"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            {showOps && (
              <label className="text-xs opacity-90">
                <span className="mb-1 block font-semibold">View inventory for</span>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="min-w-52 rounded-lg border-0 bg-white p-2 text-sm text-slate-900">
                  {locations().map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
            {role === "picker" && (
              <label className="text-xs opacity-90">
                <span className="mb-1 block font-semibold">You are picker</span>
                <select value={currentPicker} onChange={(e) => setCurrentPicker(e.target.value)} className="min-w-40 rounded-lg border-0 bg-white p-2 text-sm text-slate-900">
                  {pickers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}
            {showFreeze && (
              <div className="inline-flex gap-1 rounded-lg bg-white/15 p-1">
                <button onClick={() => setPhase(1)} className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${phase === 1 ? "bg-white text-teal-900" : "text-white"}`}>Phase 1 · Daily email</button>
                <button onClick={() => setPhase(2)} className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${phase === 2 ? "bg-white text-teal-900" : "text-white"}`}>Phase 2 · API</button>
              </div>
            )}
          </div>

          {showFreeze && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${anyOpen() ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
              {anyOpen() ? (
                <>⚠ Inventory feed <b>FROZEN</b> — open task(s): {openNos}. New {source} stock will not load until all picking is complete.</>
              ) : (
                <>Inventory feed: <b>{source}</b> — no open task, feed is live.</>
              )}
            </div>
          )}
        </header>

        {role === "admin" && (
          <div className="mt-4 space-y-4"><AdminConfig /><StockPanel /></div>
        )}
        {role === "planner" && (
          <div className="mt-4 space-y-4"><DemandPanel /><RegisterPanel /><PerformancePanel /></div>
        )}
        {role === "supervisor" && (
          <div className="mt-4 space-y-4"><StockPanel /><RegisterPanel /><PerformancePanel /></div>
        )}
        {role === "picker" && (
          <div className="mt-4"><PickerView /></div>
        )}

        <p className="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">FEFO Smart Picking · React + Supabase-ready · Mosaic Wellness</p>
      </div>
    </div>
  );
}
