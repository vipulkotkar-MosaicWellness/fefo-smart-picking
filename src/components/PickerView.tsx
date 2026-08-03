import { useEffect, useState } from "react";
import { useAuth } from "../lib/authStore";
import { criticalPathSort } from "../lib/engine";
import { monLabel } from "../lib/format";
import { loadQueue } from "../lib/offlineQueue";
import { allFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist, PickLine } from "../lib/types";
import { Button, Tag } from "./Ui";

const EXCEPTION_REASONS = ["Not enough stock", "Batch not found", "Damaged stock", "Location blocked", "Other"] as const;

function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(loadQueue().length);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(() => setQueued(loadQueue().length), 2000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
  }, []);
  if (online && queued === 0) return <Tag tone="ok">Online</Tag>;
  if (!online) return <Tag tone="warn">Offline{queued ? ` · ${queued} queued` : ""}</Tag>;
  return <Tag tone="info">Syncing {queued} queued…</Tag>;
}

export function PickerView() {
  const { tasks, applyPicks } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "");

  // facility picklists that have lines assigned to me and still to pick
  const myLists = allFacilityLists(tasks)
    .map((f) => ({ f, mine: f.lines.filter((l) => l.picker === myName && l.picked == null) }))
    .filter((x) => x.mine.length > 0);

  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [nfMap, setNfMap] = useState<Record<number, number>>({});
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState<string>(EXCEPTION_REASONS[0]);
  const [nfVal, setNfVal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ facility: string; picked: number; nf: number } | null>(null);

  const chosen = selectedNo ? myLists.find((x) => x.f.no === selectedNo) : undefined;
  const f: FacilityPicklist | undefined = chosen?.f;
  const lines: PickLine[] = chosen ? criticalPathSort(chosen.mine) : [];
  const line = lines[idx];
  const next = lines[idx + 1];

  function start(no: string) { setSelectedNo(no); setIdx(0); setNfMap({}); setExceptionMode(false); setDone(null); }
  function reset() { setSelectedNo(null); setDone(null); }

  async function advance(nextNf: Record<number, number>) {
    setExceptionMode(false);
    if (idx + 1 < lines.length) { setIdx(idx + 1); return; }
    if (!f || busy) return;
    setBusy(true);
    try {
      await applyPicks(f.no, nextNf);
      const picked = lines.reduce((s, l) => s + (l.qty - (nextNf[l.rid] ?? 0)), 0);
      const nf = lines.reduce((s, l) => s + (nextNf[l.rid] ?? 0), 0);
      setDone({ facility: f.facility, picked, nf });
      setSelectedNo(null);
    } finally {
      setBusy(false);
    }
  }
  function picked() {
    if (!line || busy) return; // duplicate-confirm protection: ignore a second tap while the first is still processing
    const next = { ...nfMap, [line.rid]: 0 };
    setNfMap(next);
    void advance(next);
  }
  function confirmException() {
    if (!line || busy) return;
    const next = { ...nfMap, [line.rid]: Math.min(Math.max(nfVal, 0), line.qty) };
    setNfMap(next);
    void advance(next);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="text-4xl">✓</div>
          <h2 className="mt-2 text-lg font-bold text-emerald-800 dark:text-emerald-300">Your picking is done</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{done.facility}</p>
          <div className="mt-3 text-sm">Picked <b>{done.picked}</b> units{done.nf ? <> · <b>{done.nf}</b> not found</> : null}</div>
        </div>
        <div className="mt-4 text-center"><Button onClick={reset}>Back to my picklists</Button></div>
      </div>
    );
  }

  if (!f) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">My picklists</h2>
          <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            Picker: <b>{myName}</b> <SyncStatus />
          </span>
        </div>
        {myLists.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
            Nothing assigned to you yet. The supervisor assigns picklists in the Operator view.
          </p>
        ) : (
          <div className="space-y-2">
            {myLists.map(({ f: fl, mine }) => (
              <button key={fl.no} onClick={() => start(fl.no)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700">
                <div>
                  <div className="font-semibold">{fl.facility}{fl.round > 1 ? " · Round " + fl.round : ""}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{fl.no}</div>
                </div>
                <Tag tone="warn">{mine.length} lines</Tag>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const total = lines.length;
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={reset} className="text-sm text-teal-700 dark:text-teal-300">‹ Back</button>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          {f.facility} <SyncStatus />
        </div>
      </div>
      <div className="mb-3 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${(idx / total) * 100}%` }} /></div>
      <p className="mb-2 text-center text-xs text-slate-500 dark:text-slate-400">Line {idx + 1} of {total}</p>

      {line && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Go to location</div>
          <div className="my-1 text-4xl font-extrabold tracking-tight text-teal-700 dark:text-teal-300">{line.bin}</div>
          <div className="mt-2 text-base font-semibold">{line.name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            SKU {line.sku}
            <br />
            Batch <b>{line.batch}</b> · exp {monLabel(line.exp)}
          </div>
          <div className="mt-3 inline-block rounded-lg bg-slate-100 px-4 py-2 text-2xl font-bold tabular-nums dark:bg-slate-900">Pick {line.qty}</div>

          {!exceptionMode ? (
            <div className="mt-5 space-y-2">
              <button onClick={picked} disabled={busy} className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Saving…" : `✓ Found — Picked ${line.qty}`}
              </button>
              <button onClick={() => { setNfVal(line.qty); setExceptionReason(EXCEPTION_REASONS[0]); setExceptionMode(true); }} disabled={busy} className="w-full rounded-xl border border-amber-500 py-3 text-sm font-semibold text-amber-700 disabled:opacity-60 dark:text-amber-300">
                Not found
              </button>
            </div>
          ) : (
            <div className="mt-5 text-left">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Issue</label>
              <select
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                {EXCEPTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <label className="mt-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">Available quantity</label>
              <div className="mt-2 flex items-center justify-center gap-3">
                <button onClick={() => setNfVal(Math.max(0, nfVal - 1))} className="h-10 w-10 rounded-lg bg-slate-200 text-xl dark:bg-slate-700">−</button>
                <input type="number" min={0} max={line.qty} value={line.qty - nfVal} onChange={(e) => setNfVal(Math.min(line.qty, Math.max(0, line.qty - (parseInt(e.target.value, 10) || 0))))} className="w-20 rounded-lg border border-slate-300 p-2 text-center text-lg dark:border-slate-600 dark:bg-slate-900" />
                <button onClick={() => setNfVal(Math.min(line.qty, nfVal + 1))} className="h-10 w-10 rounded-lg bg-slate-200 text-xl dark:bg-slate-700">+</button>
              </div>
              <p className="mt-1 text-center text-[11px] text-slate-500 dark:text-slate-400">{line.qty - nfVal} available · {nfVal} short</p>
              <div className="mt-3 flex gap-2">
                <button onClick={confirmException} disabled={busy} className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60">
                  {busy ? "Saving…" : "Submit exception"}
                </button>
                <Button variant="sm" onClick={() => setExceptionMode(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {next && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">Up next</span>
          <span className="font-semibold">{next.bin} · {next.qty} units</span>
          <span aria-hidden>→</span>
        </div>
      )}
    </div>
  );
}
