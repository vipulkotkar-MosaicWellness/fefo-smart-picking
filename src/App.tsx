import { DemandPanel } from "./components/DemandPanel";
import { PerformancePanel } from "./components/PerformancePanel";
import { RegisterPanel } from "./components/RegisterPanel";
import { StockPanel } from "./components/StockPanel";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { useStore } from "./lib/store";

export default function App() {
  const { location, setLocation, locations, phase, setPhase, anyOpen, picklists } = useStore();
  const source = phase === 1 ? "Daily auto-generated email" : "API (real-time)";
  const openNos = picklists.filter((p) => p.status === "open").map((p) => p.no).join(", ");

  return (
    <div className="min-h-full bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-6xl p-4">
        <header className="rounded-xl bg-gradient-to-br from-teal-700 to-teal-900 p-5 text-white shadow">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">FEFO Smart Picking</h1>
              <p className="text-xs opacity-90">
                Upload stock · select location · generate by SKU · one-click complete with not-found at qty level
              </p>
            </div>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">
              {isSupabaseConfigured ? "Supabase connected" : "Local mode (browser)"}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="text-xs opacity-90">
              <span className="mb-1 block font-semibold">Pick from location</span>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="min-w-52 rounded-lg border-0 bg-white p-2 text-sm text-slate-900"
              >
                {locations().map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-flex gap-1 rounded-lg bg-white/15 p-1">
              <button
                onClick={() => setPhase(1)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${phase === 1 ? "bg-white text-teal-900" : "text-white"}`}
              >
                Phase 1 · Daily email
              </button>
              <button
                onClick={() => setPhase(2)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${phase === 2 ? "bg-white text-teal-900" : "text-white"}`}
              >
                Phase 2 · API
              </button>
            </div>
          </div>

          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${anyOpen() ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
          >
            {anyOpen() ? (
              <>⚠ Inventory feed <b>FROZEN</b> — master picklist open ({openNos}). New {source} stock will not load until it is completed.</>
            ) : (
              <>Inventory feed: <b>{source}</b> — no master picklist open, feed is live.</>
            )}
          </div>
        </header>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <StockPanel />
          <DemandPanel />
        </div>
        <div className="mt-4">
          <RegisterPanel />
        </div>
        <div className="mt-4">
          <PerformancePanel />
        </div>

        <p className="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
          FEFO Smart Picking · React + Supabase-ready · Mosaic Wellness
        </p>
      </div>
    </div>
  );
}
