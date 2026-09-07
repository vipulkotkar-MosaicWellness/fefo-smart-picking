import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { FACILITY_PRIORITY } from "../lib/facilities";
import { downloadCsv } from "../lib/format";
import { groupHoldsByFacilityAndDate, holdMatchesSearch, onHandQty, type HoldFacilityGroup } from "../lib/holds";
import { useStore } from "../lib/store";
import type { Hold, StockRow } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso?: string): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

function dateLabel(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function csvFrom(header: string, rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return header + "\n" + rows.map((r) => r.map((v) => cell(String(v))).join(",")).join("\n") + "\n";
}

/** Holds still pending release, with their live current shelf qty. */
function activeCsv(active: Hold[], stock: StockRow[]): string {
  return csvFrom(
    "SKU,Facility,Bin,Batch,Qty on hold,Current shelf qty,Held since,Held by,Reason,Source picklist",
    active.map((h) => [
      h.sku,
      h.facility,
      h.bin,
      h.batch,
      String(h.qty),
      String(onHandQty(stock, h.sku, h.facility, h.bin, h.batch)),
      timeLabel(h.heldAt),
      h.heldBy,
      h.reason ?? "",
      h.sourceTaskNo ?? "",
    ]),
  );
}

function releasedCsv(released: Hold[]): string {
  return csvFrom(
    "SKU,Facility,Bin,Batch,Qty on hold,Held since,Held by,Reason,Source picklist,Released at,Released by",
    released.map((h) => [h.sku, h.facility, h.bin, h.batch, String(h.qty), timeLabel(h.heldAt), h.heldBy, h.reason ?? "", h.sourceTaskNo ?? "", timeLabel(h.releasedAt), h.releasedBy ?? ""]),
  );
}

/** One date's worth of holds within a facility — its own collapsible level, lazy like the facility above it. */
function DateGroup({
  date,
  holds,
  stock,
  canRelease,
  selected,
  onToggleOne,
  onToggleAll,
}: {
  date: string;
  holds: Hold[];
  stock: StockRow[];
  canRelease: boolean;
  selected: Set<number>;
  onToggleOne: (id: number, checked: boolean) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  const ids = holds.map((h) => h.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  return (
    <details className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700 [&_summary::-webkit-details-marker]:hidden" onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-900">
        <span className="font-medium text-slate-700 dark:text-slate-200">{dateLabel(date)}</span>
        <Tag tone="muted">{holds.length}</Tag>
      </summary>
      {opened && (
        <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                {canRelease && (
                  <th className="w-6 border-b border-slate-200 p-1.5 dark:border-slate-700">
                    <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(ids, e.target.checked)} aria-label={`Select all holds on ${dateLabel(date)}`} />
                  </th>
                )}
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Bin</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Qty on hold</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Current shelf qty</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held since</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held by</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reason</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Source picklist</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                  {canRelease && (
                    <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                      <input type="checkbox" checked={selected.has(h.id)} onChange={(e) => onToggleOne(h.id, e.target.checked)} aria-label={`Select hold on ${h.sku} ${h.bin}`} />
                    </td>
                  )}
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{h.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{h.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{h.qty}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold text-rose-600 dark:border-slate-700/60 dark:text-rose-400">
                    {onHandQty(stock, h.sku, h.facility, h.bin, h.batch)}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.heldBy}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.reason ? <Tag tone="warn">{h.reason}</Tag> : "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.sourceTaskNo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

// Only 3 facilities, ever — no reason to hide them behind a click the way
// the (potentially many) dates within one are. Always visible, side by
// side; the dates underneath are what actually collapse.
function FacilityColumn({
  group,
  stock,
  canRelease,
  selected,
  onToggleOne,
  onToggleAll,
}: {
  group: HoldFacilityGroup;
  stock: StockRow[];
  canRelease: boolean;
  selected: Set<number>;
  onToggleOne: (id: number, checked: boolean) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
}) {
  const total = group.dates.reduce((s, d) => s + d.holds.length, 0);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2 text-sm font-semibold dark:bg-slate-900">
        <span>{group.facility}</span>
        <Tag tone="info">{total}</Tag>
      </div>
      <div className="p-2">
        {group.dates.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-slate-400">No active holds here.</p>
        ) : (
          group.dates.map((d) => (
            <DateGroup key={d.date} date={d.date} holds={d.holds} stock={stock} canRelease={canRelease} selected={selected} onToggleOne={onToggleOne} onToggleAll={onToggleAll} />
          ))
        )}
      </div>
    </div>
  );
}

export function StockHolds() {
  const holds = useStore((s) => s.holds);
  const stock = useStore((s) => s.stock);
  const releaseHold = useStore((s) => s.releaseHold);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const role = useAuth((s) => s.profile?.role);
  const canRelease = role === "admin" || role === "super_admin";
  const [bulkReleasing, setBulkReleasing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allActive = holds.filter((h) => !h.releasedAt);
  const allReleased = holds
    .filter((h) => h.releasedAt)
    .sort((a, b) => new Date(b.releasedAt ?? 0).getTime() - new Date(a.releasedAt ?? 0).getTime());

  const active = allActive.filter((h) => holdMatchesSearch(h, search));
  const released = allReleased.filter((h) => holdMatchesSearch(h, search));
  // Always show all 3 facilities side by side, even one with zero matching
  // holds right now — groupHoldsByFacilityAndDate only returns facilities
  // that actually appear in `active`, so backfill any missing ones empty.
  const groupsByName = new Map(groupHoldsByFacilityAndDate(active, FACILITY_PRIORITY).map((g) => [g.facility, g]));
  const groups = FACILITY_PRIORITY.map((facility) => groupsByName.get(facility) ?? { facility, dates: [] });

  function toggleOne(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function releaseSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Release ${ids.length} selected hold(s)? Each becomes eligible for future picklists again.`)) return;
    setBulkReleasing(true);
    try {
      // Sequential, not Promise.all — each releaseHold() re-fetches holds
      // from Supabase afterward (see store.ts), so awaiting one at a time
      // keeps that re-fetch authoritative instead of racing on completion order.
      for (const id of ids) {
        await releaseHold(id, myName);
      }
      setSelected(new Set());
    } finally {
      setBulkReleasing(false);
    }
  }

  return (
    <Card title={`Stock holds (${allActive.length} active)`}>
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        A SKU + Facility + Bin + Batch combination lands here automatically whenever it's marked not-found during
        picking. "Qty on hold" is the shelf's stock level right after the picked amount was deducted (e.g. bin qty
        100, picked 5 → 95 on hold) — the entire remaining lot is excluded from every future picklist, fresh or
        round-2, until released. A hold is also auto-released the moment its lot's current shelf qty reaches 0 —
        nothing's left there to block — logged as released by "System (shelf emptied)" so it stays in the release
        history below rather than just disappearing. If that same lot gets restocked and goes not-found again later,
        a fresh hold is created then.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU, bin, or batch…"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        {canRelease && selected.size > 0 && (
          <Button variant="sm" onClick={() => void releaseSelected()} disabled={bulkReleasing}>
            {bulkReleasing ? "Releasing…" : `Release ${selected.size} selected`}
          </Button>
        )}
        <Button variant="sm" onClick={() => downloadCsv(activeCsv(active, stock), "stock_holds_pending_release.csv")} disabled={active.length === 0}>
          Export CSV
        </Button>
      </div>

      {allActive.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds right now.</p>
      ) : active.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds match "{search}".</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-start">
          {groups.map((g) => (
            <FacilityColumn key={g.facility} group={g} stock={stock} canRelease={canRelease} selected={selected} onToggleOne={toggleOne} onToggleAll={toggleAll} />
          ))}
        </div>
      )}

      {!canRelease && allActive.length > 0 && (
        <p className="mt-2 text-[10px] text-slate-400" title="Only Admin and Super Admin can release a hold">
          Releasing a hold requires Admin or Super Admin.
        </p>
      )}

      <div className="mt-5 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Release history</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {allReleased.length === 0
              ? "Nothing released yet."
              : search
                ? `${released.length} of ${allReleased.length} match "${search}"`
                : `${allReleased.length} released, all time`}
          </p>
        </div>
        <Button variant="sm" onClick={() => downloadCsv(releasedCsv(released), "stock_holds_released.csv")} disabled={released.length === 0}>
          Download CSV
        </Button>
      </div>
    </Card>
  );
}
