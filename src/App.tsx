import { useEffect } from "react";
import { AdminConfig } from "./components/AdminConfig";
import { AdminUsers } from "./components/AdminUsers";
import { AuthGate, PendingApproval } from "./components/AuthGate";
import { DemandPanel } from "./components/DemandPanel";
import { InventoryPanel } from "./components/InventoryPanel";
import { PerformancePanel } from "./components/PerformancePanel";
import { PickerView } from "./components/PickerView";
import { PicklistRepository } from "./components/PicklistRepository";
import { SupervisorQueue } from "./components/SupervisorQueue";
import { useAuth } from "./lib/authStore";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { useStore } from "./lib/store";

function AppShell() {
  const {
    locations, visibleFacilities, toggleFacility, anyOpen, tasks, lastSync, syncStock, syncing, notice,
    loadFromSupabase, loadTasks, startTasksRealtime, loadPickers,
  } = useStore();
  const { profile, signOut } = useAuth();
  const role = profile!.role as "super_admin" | "admin" | "planner" | "supervisor" | "picker";
  const isAdminTier = role === "admin" || role === "super_admin";

  useEffect(() => {
    void loadFromSupabase();
    void loadTasks();
    void loadPickers();
    const stop = startTasksRealtime();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-90">
                  Signed in as <b>{profile!.display_name}</b> · <span className="capitalize">{role.replace("_", " ")}</span>
                </span>
                <button onClick={() => void signOut()} className="rounded-md bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30">
                  Sign out
                </button>
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

        {isAdminTier && (
          <div className="mt-4 space-y-4">
            <AdminConfig />
            <AdminUsers />
            <PicklistRepository />
            <InventoryPanel />
          </div>
        )}
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
            <PicklistRepository />
            <InventoryPanel />
          </div>
        )}
        {role === "picker" && <div className="mt-4"><PickerView /></div>}

        <p className="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">FEFO Smart Picking · React + Supabase-ready · Mosaic Wellness</p>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, userId, profile, init } = useAuth();

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isSupabaseConfigured) {
    // Local/demo mode has no auth backend — nothing to gate.
    return <LocalDemoNotice />;
  }
  if (loading) {
    return <div className="flex min-h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (!userId) return <AuthGate />;
  if (!profile || profile.role === "pending") return <PendingApproval email={profile?.email ?? ""} />;
  return <AppShell />;
}

function LocalDemoNotice() {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4 dark:bg-slate-900">
      <div className="max-w-sm rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        Supabase isn't configured, so logins are unavailable — this build is running in local demo mode only.
      </div>
    </div>
  );
}
