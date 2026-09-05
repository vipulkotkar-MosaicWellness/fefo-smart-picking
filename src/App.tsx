import { useEffect, useMemo, useState } from "react";
import { AdminConfig } from "./components/AdminConfig";
import { AdminUsers } from "./components/AdminUsers";
import { ArchivedPicklists } from "./components/admin/ArchivedPicklists";
import { DiscardedPicklists } from "./components/admin/DiscardedPicklists";
import { InventoryUploadFallback } from "./components/admin/InventoryUploadFallback";
import { PartnerDirectory } from "./components/admin/PartnerDirectory";
import { AppShell } from "./components/AppShell";
import { MosaicLogo } from "./components/brand/MosaicLogo";
import { AuthGate, PendingApproval, SetNewPassword } from "./components/AuthGate";
import { DemandPanel } from "./components/DemandPanel";
import { GatepassAdherence } from "./components/GatepassAdherence";
import { GatePassPending } from "./components/GatePassPending";
import { InventoryPanel } from "./components/InventoryPanel";
import { PerformanceSummaryTiles } from "./components/PerformanceSummaryTiles";
import { PickerView } from "./components/PickerView";
import { Reports } from "./components/Reports";
import { StockHolds } from "./components/StockHolds";
import { SupervisorQueue } from "./components/SupervisorQueue";
import { Tag } from "./components/Ui";
import { useAuth } from "./lib/authStore";
import { getNavigation, type ViewId } from "./lib/navigation";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { activeFacilityLists, pendingGatePassFacilityLists, supervisorVisibleFacilityLists, useStore } from "./lib/store";
import { syncSourceLabel } from "./lib/syncSource";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const VIEW_LABEL: Record<ViewId, string> = {
  adherence: "Gate Pass Adherence",
  demand: "Demand Planner",
  supervisor: "Picking Supervisor",
  picker: "Picker",
  inventory: "Inventory",
  holds: "Stock Holds",
  reports: "Reports",
  admin: "Admin",
};

function HeaderActions({ role, displayName, onSignOut }: { role: string; displayName: string; onSignOut: () => void }) {
  return (
    <>
      <span className="hidden rounded-full bg-[var(--fefo-teal-50)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fefo-teal-700)] sm:inline-block dark:bg-slate-700 dark:text-teal-300">
        {isSupabaseConfigured ? "Supabase connected" : "Local mode"}
      </span>
      <span className="hidden text-xs text-[var(--fefo-muted)] md:inline dark:text-slate-400">
        <b className="text-[var(--fefo-text)] dark:text-slate-100">{displayName}</b> ·{" "}
        <span className="capitalize">{role === "planner" ? "Planner / Supervisor" : role.replace("_", " ")}</span>
      </span>
      <span
        aria-hidden
        title={displayName}
        className="hidden h-9 w-9 items-center justify-center rounded-full bg-[var(--fefo-teal-950)] text-xs font-bold text-white sm:flex"
      >
        {initialsOf(displayName)}
      </span>
      <button
        onClick={onSignOut}
        className="rounded-md border border-[var(--fefo-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--fefo-text)] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Sign out
      </button>
    </>
  );
}

function OperationsToolbar() {
  const { locations, visibleFacilities, toggleFacility, tasks, lastSyncSource, lastSyncBy, facilityLastSynced, syncStock, syncing, notice } =
    useStore();
  // Must mirror anyOpen()'s own filtering exactly (activeFacilityLists, and
  // skip anything WMS-blocked) — otherwise this list shows archived,
  // discarded, or already-WMS-blocked tasks as if they were still holding
  // the freeze, when none of them actually are. Grouped by facility since
  // the freeze — and now the sync itself — is per-facility, not global: one
  // facility having an open task no longer means every facility is stuck.
  const openTaskNosByFacility = new Map<string, Set<string>>();
  for (const f of activeFacilityLists(tasks)) {
    if (f.wmsBlocked || !f.lines.some((l) => l.picked == null)) continue;
    if (!openTaskNosByFacility.has(f.facility)) openTaskNosByFacility.set(f.facility, new Set());
    openTaskNosByFacility.get(f.facility)!.add(f.taskNo);
  }
  const source = syncSourceLabel(lastSyncSource, lastSyncBy);

  return (
    <div className="rounded-2xl border border-[var(--fefo-line)] bg-white p-3.5 shadow-[var(--fefo-shadow)] dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-[var(--fefo-muted)] dark:text-slate-400">Show inventory:</span>
          {locations().map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={visibleFacilities.includes(f)}
                onChange={() => toggleFacility(f)}
                className="h-3.5 w-3.5 accent-[var(--fefo-teal-700)]"
              />
              {f}
            </label>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Tag tone={source.tone}>{source.text}</Tag>
          <button
            onClick={syncStock}
            disabled={syncing}
            className="rounded-md bg-[var(--fefo-teal-700)] px-2.5 py-1.5 font-semibold text-white hover:bg-[var(--fefo-teal-900)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`mt-2.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            notice.startsWith("✗")
              ? "bg-[var(--fefo-danger-bg)] text-rose-900"
              : notice.startsWith("⚠")
                ? "bg-[var(--fefo-warning-bg)] text-amber-900"
                : "bg-[var(--fefo-teal-50)] text-[var(--fefo-teal-700)]"
          }`}
        >
          {notice}
        </div>
      )}

      {/* Per-facility sync status — each facility refreshes independently now,
          so one blended timestamp would understate how stale a busy facility
          really is. */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {locations().map((f) => {
          const openNos = [...(openTaskNosByFacility.get(f) ?? [])].join(", ");
          const frozen = openTaskNosByFacility.has(f);
          const synced = facilityLastSynced[f];
          const syncedLabel = synced
            ? new Date(synced).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : "never synced";
          return (
            <div
              key={f}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                frozen ? "bg-[var(--fefo-warning-bg)] text-amber-900" : "bg-[var(--fefo-teal-50)] text-[var(--fefo-teal-700)]"
              }`}
              title={frozen ? `Open: ${openNos}` : undefined}
            >
              <span className="mr-1">{f}:</span>
              {frozen ? (
                <>
                  ⚠ <b>frozen</b> (picking in progress) — last synced <b>{syncedLabel}</b>
                </>
              ) : (
                <>
                  <b>live</b> — last synced <b>{syncedLabel}</b>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Workspace() {
  const {
    loadFromSupabase,
    loadTasks,
    startTasksRealtime,
    loadHolds,
    loadPickers,
    startPickersRealtime,
    loadChannelOverrides,
    startChannelOverridesRealtime,
    tasks,
    flushOfflineQueue,
    checkWmsAutoBlock,
    checkHoldAutoRelease,
    loadAutoCompleteSetting,
    startAutoCompleteSettingRealtime,
    checkPicklistAutoComplete,
  } = useStore();
  const { profile, signOut } = useAuth();
  const role = profile!.role as "super_admin" | "admin" | "planner" | "picker" | "inventory_planner";
  const isAdminTier = role === "admin" || role === "super_admin";

  const unassignedCount = supervisorVisibleFacilityLists(tasks).filter(
    (f) => f.status !== "completed" && !f.lines.some((l) => l.picker),
  ).length;
  const pendingGatePassCount = pendingGatePassFacilityLists(tasks).length;
  const activeHoldsCount = useStore((s) => s.holds).filter((h) => !h.releasedAt).length;

  const navItems = useMemo(() => getNavigation(role), [role]);
  const [activeView, setActiveView] = useState<ViewId>(navItems[0]?.id ?? "picker");
  useEffect(() => {
    if (!navItems.some((item) => item.id === activeView)) setActiveView(navItems[0]?.id ?? "picker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    void loadFromSupabase();
    void loadTasks();
    void loadHolds();
    void loadPickers();
    void loadChannelOverrides();
    void loadAutoCompleteSetting();
    void flushOfflineQueue();
    const stop = startTasksRealtime();
    const stopPickers = startPickersRealtime();
    const stopChannelOverrides = startChannelOverridesRealtime();
    const stopAutoCompleteSetting = startAutoCompleteSettingRealtime();
    const onOnline = () => void flushOfflineQueue();
    window.addEventListener("online", onOnline);
    // Sweeps for picklists whose 15-minute WMS-block clock has run out.
    // Client-side only — see WMS_BLOCK_DELAY_MS in store.ts.
    void checkWmsAutoBlock();
    const wmsTimer = window.setInterval(() => void checkWmsAutoBlock(), 60_000);
    // Sweeps for stock holds whose lot has emptied out — see
    // dueForHoldAutoRelease in lib/holds.ts.
    void checkHoldAutoRelease();
    const holdTimer = window.setInterval(() => void checkHoldAutoRelease(), 60_000);
    // Aged-WMS-blocked-picklist auto-close — only does anything once Super
    // Admin has turned the timer on (autoCompleteAfterDays). See
    // dueForAutoComplete in lib/store.ts.
    void checkPicklistAutoComplete();
    const autoCompleteTimer = window.setInterval(() => void checkPicklistAutoComplete(), 60_000);
    return () => {
      stop();
      stopPickers();
      stopChannelOverrides();
      stopAutoCompleteSetting();
      window.removeEventListener("online", onOnline);
      window.clearInterval(wmsTimer);
      window.clearInterval(holdTimer);
      window.clearInterval(autoCompleteTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (role === "picker") {
    return (
      <div className="min-h-screen bg-[var(--fefo-bg)] dark:bg-slate-900">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-[var(--fefo-line)] bg-white px-4 dark:border-slate-700 dark:bg-slate-800">
          <MosaicLogo compact />
          <span className="text-sm font-extrabold tracking-tight text-[var(--fefo-text)] dark:text-slate-100">FEFO Pick</span>
          <button
            onClick={() => void signOut()}
            className="ml-auto rounded-md border border-[var(--fefo-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--fefo-text)] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Sign out
          </button>
        </header>
        <div className="p-4">
          <PickerView />
        </div>
      </div>
    );
  }

  return (
    <AppShell
      navItems={navItems}
      activeView={activeView}
      onNavigate={setActiveView}
      breadcrumb={VIEW_LABEL[activeView]}
      headerActions={<HeaderActions role={role} displayName={profile!.display_name} onSignOut={() => void signOut()} />}
      badges={{ supervisor: unassignedCount, holds: activeHoldsCount, demand: pendingGatePassCount }}
    >
      {activeView !== "adherence" && <OperationsToolbar />}
      {activeView === "adherence" && (
        <div className="space-y-4">
          <GatepassAdherence />
        </div>
      )}
      {activeView === "demand" && (
        <div className="space-y-4">
          {role === "inventory_planner" && <InventoryUploadFallback />}
          <DemandPanel />
          <GatePassPending />
          <PerformanceSummaryTiles tasks={tasks} onViewReport={() => setActiveView("reports")} />
        </div>
      )}
      {activeView === "supervisor" && (
        <div className="space-y-4">
          <SupervisorQueue />
        </div>
      )}
      {activeView === "inventory" && <InventoryPanel />}
      {activeView === "holds" && <StockHolds />}
      {activeView === "reports" && <Reports />}
      {activeView === "admin" && isAdminTier && (
        <div className="space-y-4">
          <AdminConfig />
          <InventoryUploadFallback />
          <ArchivedPicklists />
          <DiscardedPicklists />
          <AdminUsers />
          <PartnerDirectory />
        </div>
      )}
    </AppShell>
  );
}

export default function App() {
  const { loading, userId, profile, passwordRecovery, init } = useAuth();

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isSupabaseConfigured) {
    // Local/demo mode has no auth backend — nothing to gate.
    return <LocalDemoNotice />;
  }
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  // Takes priority over normal routing — a password-reset email link signs
  // the visitor into a temporary recovery session, not a real login.
  if (passwordRecovery) return <SetNewPassword />;
  if (!userId) return <AuthGate />;
  if (!profile || profile.role === "pending") return <PendingApproval email={profile?.email ?? ""} />;
  return <Workspace />;
}

function LocalDemoNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-900">
      <div className="max-w-sm rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        Supabase isn't configured, so logins are unavailable — this build is running in local demo mode only.
      </div>
    </div>
  );
}
