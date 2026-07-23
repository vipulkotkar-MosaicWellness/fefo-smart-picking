import { useEffect, useRef, useState } from "react";
import { criticalPathSort } from "../lib/engine";
import { monLabel } from "../lib/format";
import { allFacilityLists, useStore } from "../lib/store";
import type { FacilityPicklist } from "../lib/types";
import { Button, Tag } from "./Ui";

function Scanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    const Detector = (window as unknown as { BarcodeDetector?: new () => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      setErr("Live scanning needs the HHT / Capacitor build or a supported browser. Use “Confirm” below.");
      return;
    }
    const det = new Detector();
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
          tick();
        }
      })
      .catch(() => setErr("Camera not available on this device."));

    async function tick() {
      if (!videoRef.current) return;
      try {
        const codes = await det.detect(videoRef.current);
        if (codes.length) return onDetect(codes[0].rawValue);
      } catch {
        /* keep scanning */
      }
      raf = requestAnimationFrame(tick);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 dark:bg-slate-800">
        <p className="mb-2 text-sm font-semibold">Scan bin / product</p>
        {err ? (
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">{err}</p>
        ) : (
          <video ref={videoRef} className="mb-3 w-full rounded-lg bg-black" muted playsInline />
        )}
        <div className="flex gap-2">
          <Button variant="green" onClick={() => onDetect("manual")}>Confirm</Button>
          <Button variant="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export function PickerView() {
  const { tasks, markFacilityCompleted } = useStore();
  const openLists = allFacilityLists(tasks).filter((f) => f.status === "open");

  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [nfMap, setNfMap] = useState<Record<number, number>>({});
  const [nfMode, setNfMode] = useState(false);
  const [nfVal, setNfVal] = useState(0);
  const [scan, setScan] = useState(false);
  const [doneNo, setDoneNo] = useState<string | null>(null);

  const f: FacilityPicklist | undefined = selectedNo ? openLists.find((x) => x.no === selectedNo) : undefined;
  const lines = f ? criticalPathSort(f.lines) : [];
  const line = lines[idx];

  function start(no: string) {
    setSelectedNo(no);
    setIdx(0);
    setNfMap({});
    setNfMode(false);
    setDoneNo(null);
  }
  function reset() {
    setSelectedNo(null);
    setDoneNo(null);
  }
  function advance(nextNf: Record<number, number>) {
    setNfMode(false);
    if (idx + 1 < lines.length) {
      setIdx(idx + 1);
    } else if (f) {
      markFacilityCompleted(f.taskNo, f.no, nextNf);
      setDoneNo(f.no);
      setSelectedNo(null);
    }
  }
  function picked() {
    if (!line) return;
    advance({ ...nfMap, [line.rid]: 0 });
  }
  function confirmNotFound() {
    if (!line) return;
    const next = { ...nfMap, [line.rid]: Math.min(Math.max(nfVal, 0), line.qty) };
    setNfMap(next);
    advance(next);
  }

  if (doneNo) {
    const done = allFacilityLists(tasks).find((x) => x.no === doneNo);
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="text-4xl">✓</div>
          <h2 className="mt-2 text-lg font-bold text-emerald-800 dark:text-emerald-300">Picking completed</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{done?.no} · {done?.facility}</p>
          {done && (
            <div className="mt-3 text-sm">
              <div>Gatepass <b>{done.gp}</b></div>
              <div>Picked <b>{done.pickedTotal}</b> units{done.bad ? <> · <b>{done.bad}</b> not found</> : null}</div>
            </div>
          )}
        </div>
        <div className="mt-4 text-center">
          <Button onClick={reset}>Back to picklists</Button>
        </div>
      </div>
    );
  }

  if (!f) {
    return (
      <div className="mx-auto max-w-md p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">My picklists</h2>
        {openLists.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
            No open picklists. Generate one from the Operator view.
          </p>
        ) : (
          <div className="space-y-2">
            {openLists.map((p) => (
              <button
                key={p.no}
                onClick={() => start(p.no)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <div>
                  <div className="font-semibold">{p.facility}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{p.no}</div>
                </div>
                <Tag tone="warn">{p.lines.length} lines</Tag>
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
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{f.facility}</div>
      </div>

      <div className="mb-3 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-2 rounded-full bg-teal-600" style={{ width: `${(idx / total) * 100}%` }} />
      </div>
      <p className="mb-2 text-center text-xs text-slate-500 dark:text-slate-400">Line {idx + 1} of {total}</p>

      {line && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Go to location</div>
          <div className="my-1 text-4xl font-extrabold tracking-tight text-teal-700 dark:text-teal-300">{line.bin}</div>
          <div className="mt-2 text-base font-semibold">{line.name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{line.sku} · {line.batch} · exp {monLabel(line.exp)}</div>
          <div className="mt-3 inline-block rounded-lg bg-slate-100 px-4 py-2 text-2xl font-bold tabular-nums dark:bg-slate-900">Pick {line.qty}</div>

          {!nfMode ? (
            <div className="mt-5 space-y-2">
              <button onClick={picked} className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white hover:bg-emerald-700">✓ Picked {line.qty}</button>
              <div className="flex gap-2">
                <button onClick={() => setScan(true)} className="flex-1 rounded-xl border border-teal-600 py-3 text-sm font-semibold text-teal-700 dark:text-teal-300">Scan</button>
                <button onClick={() => { setNfVal(line.qty); setNfMode(true); }} className="flex-1 rounded-xl border border-amber-500 py-3 text-sm font-semibold text-amber-700 dark:text-amber-300">Not found</button>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">How many not found?</div>
              <div className="mt-2 flex items-center justify-center gap-3">
                <button onClick={() => setNfVal(Math.max(0, nfVal - 1))} className="h-10 w-10 rounded-lg bg-slate-200 text-xl dark:bg-slate-700">−</button>
                <input type="number" min={0} max={line.qty} value={nfVal} onChange={(e) => setNfVal(parseInt(e.target.value, 10) || 0)} className="w-20 rounded-lg border border-slate-300 p-2 text-center text-lg dark:border-slate-600 dark:bg-slate-900" />
                <button onClick={() => setNfVal(Math.min(line.qty, nfVal + 1))} className="h-10 w-10 rounded-lg bg-slate-200 text-xl dark:bg-slate-700">+</button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{line.qty - nfVal} picked · {nfVal} not found</p>
              <div className="mt-3 flex gap-2">
                <button onClick={confirmNotFound} className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700">Confirm</button>
                <Button variant="sm" onClick={() => setNfMode(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {scan && <Scanner onClose={() => setScan(false)} onDetect={() => { setScan(false); picked(); }} />}
    </div>
  );
}
