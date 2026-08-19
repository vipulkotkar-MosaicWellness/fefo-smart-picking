import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { downloadCsv } from "../lib/format";
import { onHandQty } from "../lib/holds";
import { useStore } from "../lib/store";
import type { Hold } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso?: string): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

function releasedCsv(released: Hold[]): string {
  const header = "SKU,Facility,Bin,Batch,Qty on hold,Held since,Held by,Reason,Source picklist,Released at,Released by";
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = released.map((h) =>
    [h.sku, h.facility, h.bin, h.batch, h.qty, timeLabel(h.heldAt), h.heldBy, h.reason ?? "", h.sourceTaskNo ?? "", timeLabel(h.releasedAt), h.releasedBy ?? ""]
      .map((v) => cell(String(v)))
      .join(","),
  );
  return header + "\n" + rows.join("\n") + "\n";
}

export function StockHolds() {
  const holds = useStore((s) => s.holds);
  const stock = useStore((s) => s.stock);
  const releaseHold = useStore((s) => s.releaseHold);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const role = useAuth((s) => s.profile?.role);
  const canRelease = role === "admin" || role === "super_admin";
  const [releasingId, setReleasingId] = useState<number | null>(null);

  const active = holds
    .filter((h) => !h.releasedAt)
    .sort((a, b) => new Date(b.heldAt).getTime() - new Date(a.heldAt).getTime());

  // Includes both manual releases and the auto-release sweep (releasedBy
  // "System (shelf emptied)") — see checkHoldAutoRelease in store.ts. Newest
  // first, so the CSV export and this list stay in the same order.
  const released = holds
    .filter((h) => h.releasedAt)
    .sort((a, b) => new Date(b.releasedAt ?? 0).getTime() - new Date(a.releasedAt ?? 0).getTime());

  async function release(h: Hold) {
    if (!window.confirm(`Release the hold on ${h.sku} at ${h.facility} / ${h.bin} (batch ${h.batch})? It becomes eligible for future picklists again.`)) return;
    setReleasingId(h.id);
    try {
      await releaseHold(h.id, myName);
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <Card title={`Stock holds (${active.length} active)`}>
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        A SKU + Facility + Bin + Batch combination lands here automatically whenever it's marked not-found during
        picking. "Qty on hold" is the shelf's stock level right after the picked amount was deducted (e.g. bin qty
        100, picked 5 → 95 on hold) — the entire remaining lot is excluded from every future picklist, fresh or
        round-2, until released. A hold is also auto-released the moment its lot's current shelf qty reaches 0 —
        nothing's left there to block — logged as released by "System (shelf emptied)" so it stays in the release
        history below rather than just disappearing. If that same lot gets restocked and goes not-found again later,
        a fresh hold is created then.
      </p>
      {active.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No active holds right now.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Bin</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Qty on hold</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Current shelf qty</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held since</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held by</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Reason</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Source picklist</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{h.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.facility}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{h.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{h.qty}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold text-rose-600 dark:border-slate-700/60 dark:text-rose-400">
                    {onHandQty(stock, h.sku, h.facility, h.bin, h.batch)}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.heldBy}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {h.reason ? <Tag tone="warn">{h.reason}</Tag> : "—"}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.sourceTaskNo ?? "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                    {canRelease ? (
                      <Button variant="sm" onClick={() => void release(h)} disabled={releasingId === h.id}>
                        {releasingId === h.id ? "Releasing…" : "Release"}
                      </Button>
                    ) : (
                      <span className="text-[10px] text-slate-400" title="Only Admin and Super Admin can release a hold">
                        Admin only
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 mt-5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Release history ({released.length})</h3>
        <Button variant="sm" onClick={() => downloadCsv(releasedCsv(released), "stock_holds_released.csv")} disabled={released.length === 0}>
          Export CSV
        </Button>
      </div>
      {released.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Nothing released yet.</p>
      ) : (
        <div className="max-h-[24rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">SKU</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Facility</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Bin</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Batch</th>
                <th className="border-b border-slate-200 p-1.5 text-right dark:border-slate-700">Qty on hold</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Held since</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Released at</th>
                <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Released by</th>
              </tr>
            </thead>
            <tbody>
              {released.map((h) => (
                <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 font-mono text-[10px] dark:border-slate-700/60">{h.sku}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.facility}</td>
                  <td className="border-b border-slate-100 p-1.5 font-semibold dark:border-slate-700/60">{h.bin}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.batch}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right font-semibold dark:border-slate-700/60">{h.qty}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.releasedAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {h.releasedBy === "System (shelf emptied)" ? <Tag tone="muted">{h.releasedBy}</Tag> : h.releasedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
