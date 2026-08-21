import { useMemo, useState, type ChangeEvent } from "react";
import { useAuth } from "../lib/authStore";
import { downloadCsv } from "../lib/format";
import { parseDemandCsv } from "../lib/sampleData";
import { activeTasks, computeChannelAllocations, useStore } from "../lib/store";
import { PartnerMark } from "./partners/PartnerMark";
import { Button, Card, Tag } from "./Ui";

const SAMPLE_DEMAND =
  "Blinkit, MWMMHRP.0001.AAAA.B0_N, 120, GP-100234\nAmazon, MWMMHRP.0004.AAAA.B0_N, 80, GP-100235\nMyntra, MWMMPRK.2026.AAAA.B0_N, 60, GP-100236";

const TEMPLATE =
  "Channel,SKU Code,Qty,Gate Pass Number\nBlinkit,MWMMHRP.0001.AAAA.B0_N,50,GP-100234\nAmazon,MWMMHRP.0004.AAAA.B0_N,30,GP-100235\n";

type Step = 1 | 2 | 3 | 4;
const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Import demand" },
  { id: 2, label: "Validate rows" },
  { id: 3, label: "Review allocation" },
  { id: 4, label: "Generate" },
];

interface ValidationIssues {
  badSku: string[];
  badChannel: string[];
  badQty: string[];
  duplicatesMerged: string[];
}

function WizardSteps({ step, furthest, onJump }: { step: Step; furthest: Step; onJump: (s: Step) => void }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--fefo-line)] bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800 md:grid-cols-4">
      {STEPS.map((s) => {
        const done = s.id < furthest;
        const active = s.id === step;
        const reachable = s.id <= furthest;
        return (
          <button
            key={s.id}
            onClick={() => reachable && onJump(s.id)}
            disabled={!reachable}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "bg-[var(--fefo-teal-50)] text-[var(--fefo-teal-700)]" : "text-[var(--fefo-muted)] dark:text-slate-400"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                active || done
                  ? "border-[var(--fefo-teal-700)] bg-[var(--fefo-teal-700)] text-white"
                  : "border-[var(--fefo-line)] text-[var(--fefo-muted)]"
              }`}
            >
              {done ? "✓" : s.id}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export function DemandPanel() {
  const { channelRules, skus, stock, facilityPriority, tasks, demand, setDemand, removeDemand, generate } = useStore();
  const userId = useAuth((s) => s.userId);
  const displayName = useAuth((s) => s.profile?.display_name ?? null);
  const [step, setStep] = useState<Step>(1);
  const [furthest, setFurthest] = useState<Step>(1);
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<ValidationIssues | null>(null);
  const [busy, setBusy] = useState(false);

  function goTo(s: Step) {
    setStep(s);
    setFurthest((f) => (s > f ? s : f));
  }

  function runParse(content: string) {
    const { demand: rows, badSku, badChannel, badQty, duplicatesMerged } = parseDemandCsv(content, skus, channelRules);
    setDemand(rows);
    setIssues({ badSku, badChannel, badQty, duplicatesMerged });
    goTo(2);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result);
      setText(content);
      runParse(content);
    };
    reader.readAsText(f);
  }

  const allocations = useMemo(() => {
    if (demand.length === 0) return [];
    return computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demand, channelRules, skus, stock]);

  const totalUnits = demand.reduce((s, d) => s + d.qty, 0);
  const facilitiesUsed = new Set(allocations.flatMap((a) => Object.keys(a.byFacility))).size;
  // One facility picklist per (channel, gate pass group, facility) — not one
  // per allocation group, since a single order can now span up to 3.
  const picklistCount = allocations.reduce((s, a) => s + Object.keys(a.byFacility).length, 0);
  const pendingCount = allocations.reduce((s, a) => s + Object.values(a.gatePassByFacility).filter((gp) => !gp).length, 0);
  const totalShortfall = allocations.reduce((s, a) => s + a.shortfall.reduce((x, f) => x + f.qty, 0), 0);
  const errorCount = (issues?.badSku.length ?? 0) + (issues?.badChannel.length ?? 0) + (issues?.badQty.length ?? 0);

  async function onGenerate() {
    setBusy(true);
    try {
      await generate(userId, displayName);
      setStep(1);
      setFurthest(1);
      setText("");
      setIssues(null);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDemand([]);
    setIssues(null);
    setText("");
    goTo(1);
  }

  return (
    <Card title="Create picking demand">
      <WizardSteps step={step} furthest={furthest} onJump={goTo} />

      {step === 1 && (
        <div>
          <label className="block text-[11px] font-semibold text-[var(--fefo-muted)] dark:text-slate-400">
            Paste demand rows <span className="font-normal">(Channel, SKU Code, Qty, Gate Pass Number)</span> — gate
            pass is optional. Rows sharing one still group as before; rows left blank, per channel per upload, become
            one order that's allocated by FEFO across facilities — each facility it lands on then needs its own gate
            pass, added afterward under "Gate pass allocation pending" below.
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Blinkit, MWMMHRP.0001.AAAA.B0_N, 50, GP-100234\nAmazon, MWMMHRP.0004.AAAA.B0_N, 30, GP-100235"}
            className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="sm" onClick={() => setText(SAMPLE_DEMAND)}>
              Load sample
            </Button>
            <Button variant="sm" onClick={() => downloadCsv(TEMPLATE, "demand_template.csv")}>
              Template
            </Button>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
              Upload .csv
              <input type="file" accept=".csv" className="hidden" onChange={onFile} />
            </label>
            <Button variant="sm" onClick={() => runParse(text)} disabled={!text.trim()}>
              Parse
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-[var(--fefo-muted)] dark:text-slate-400">
            Valid channels: {Object.keys(channelRules).join(", ")}
          </p>
        </div>
      )}

      {step === 2 && issues && (
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <ValidationSummary tone="ok" value={demand.length} label="Valid rows" />
            <ValidationSummary tone="warn" value={issues.duplicatesMerged.length} label="Duplicates merged" />
            <ValidationSummary tone="bad" value={issues.badChannel.length} label="Unknown channel" />
            <ValidationSummary tone="bad" value={issues.badSku.length + issues.badQty.length} label="SKU / qty errors" />
          </div>

          {errorCount > 0 && (
            <div className="mb-3 space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
              {issues.badChannel.length > 0 && (
                <p>
                  <b>Unknown channel(s)</b> — {[...new Set(issues.badChannel)].join(", ")}
                </p>
              )}
              {issues.badSku.length > 0 && (
                <p>
                  <b>Unknown SKU(s)</b> — {[...new Set(issues.badSku)].join(", ")}
                </p>
              )}
              {issues.badQty.length > 0 && (
                <p>
                  <b>Invalid quantity</b> — {[...new Set(issues.badQty)].join(", ")}
                </p>
              )}
              <p className="text-rose-700 dark:text-rose-300">These rows are excluded and won't be part of the picklist.</p>
            </div>
          )}

          <div className="space-y-1">
            {demand.length === 0 ? (
              <p className="text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">No valid rows to review.</p>
            ) : (
              demand.map((d, i) => (
                <div
                  key={`${d.channel}-${d.sku}-${d.gatePassNo ?? "pending"}-${i}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <PartnerMark name={d.channel} compact /> · {skus[d.sku]?.name ?? d.sku} · <b>{d.qty}</b> ·{" "}
                    <span className="text-[var(--fefo-muted)] dark:text-slate-400">
                      {d.gatePassNo ? `GP ${d.gatePassNo}` : "No gate pass yet"}
                    </span>
                  </span>
                  <Button variant="sm" onClick={() => removeDemand(i)}>
                    Exclude
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <Button onClick={() => goTo(3)} disabled={demand.length === 0}>
              Review allocation
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--fefo-muted)] dark:text-slate-400">
              FEFO allocation preview — pooled across all facilities, earliest-expiring eligible stock first. Every
              facility used becomes its own picklist with its own gate pass.
            </p>
            {totalShortfall > 0 && <Tag tone="warn">{totalShortfall} unit(s) short</Tag>}
          </div>

          <div className="space-y-2.5">
            {allocations.map((a, gi) => (
              <div key={`${a.channel}-${gi}`} className="rounded-lg border border-[var(--fefo-line)] p-2.5 dark:border-slate-700">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5">
                    <PartnerMark name={a.channel} />
                  </span>
                  <span className="text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">
                    {Object.values(a.byFacility).reduce((s, lines) => s + lines.reduce((x, l) => x + l.qty, 0), 0)} units
                    allocated
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  {facilityPriority
                    .filter((f) => a.byFacility[f]?.length)
                    .map((f) => {
                      const gp = a.gatePassByFacility[f];
                      return (
                        <div key={f} className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] dark:bg-slate-900">
                          <b>{f}</b>
                          <br />
                          {a.byFacility[f].reduce((s, l) => s + l.qty, 0)} units
                          <br />
                          {gp ? <Tag tone="info">GP {gp}</Tag> : <Tag tone="warn">Gate pass pending</Tag>}
                        </div>
                      );
                    })}
                </div>
                {a.unusedGatePasses.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    Not used — no facility this order allocated to matched: {a.unusedGatePasses.join(", ")}
                  </div>
                )}
                {a.shortfall.length > 0 && (
                  <div className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                    Short: {a.shortfall.map((s) => `${s.name} — ${s.qty}`).join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => goTo(2)}>
              Back
            </Button>
            <Button onClick={() => goTo(4)}>{totalShortfall > 0 ? "Continue with exceptions" : "Continue"}</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-xl border border-dashed border-[var(--fefo-line)] p-6 text-center dark:border-slate-700">
          <p className="text-lg font-bold text-[var(--fefo-text)] dark:text-slate-100">
            Ready to generate {picklistCount} picklist{picklistCount === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-[var(--fefo-muted)] dark:text-slate-400">
            {totalUnits} units · {facilitiesUsed} facilit{facilitiesUsed === 1 ? "y" : "ies"}
            {totalShortfall > 0 && ` · ${totalShortfall} unit(s) short`}
          </p>
          {pendingCount > 0 && (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              {pendingCount} of these will need a gate pass added afterward, under "Gate pass allocation pending."
            </p>
          )}
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => goTo(3)}>
              Back
            </Button>
            <Button onClick={() => void onGenerate()} disabled={demand.length === 0 || busy}>
              {busy ? "Generating…" : "Generate picklists"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ValidationSummary({ tone, value, label }: { tone: "ok" | "warn" | "bad"; value: number; label: string }) {
  return (
    <div className="rounded-lg border border-[var(--fefo-line)] bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800">
      <Tag tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "bad"}>{value}</Tag>
      <p className="mt-1.5 text-[11px] text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
    </div>
  );
}
