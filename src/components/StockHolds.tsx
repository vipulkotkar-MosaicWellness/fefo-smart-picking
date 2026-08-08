import { useState } from "react";
import { useAuth } from "../lib/authStore";
import { useStore } from "../lib/store";
import type { Hold } from "../lib/types";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function StockHolds() {
  const holds = useStore((s) => s.holds);
  const releaseHold = useStore((s) => s.releaseHold);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const [releasingId, setReleasingId] = useState<number | null>(null);

  const active = holds
    .filter((h) => !h.releasedAt)
    .sort((a, b) => new Date(b.heldAt).getTime() - new Date(a.heldAt).getTime());

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
        picking. It stays excluded from every future picklist — fresh or round-2 — until released below.
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
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{timeLabel(h.heldAt)}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.heldBy}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {h.reason ? <Tag tone="warn">{h.reason}</Tag> : "—"}
                  </td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{h.sourceTaskNo ?? "—"}</td>
                  <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
                    <Button variant="sm" onClick={() => void release(h)} disabled={releasingId === h.id}>
                      {releasingId === h.id ? "Releasing…" : "Release"}
                    </Button>
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
