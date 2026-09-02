import { useState } from "react";
import { ageDays } from "../lib/ageing";
import { downloadCsv } from "../lib/format";
import { groupPicklistFamilies, type PicklistFamily } from "../lib/picklistFamilies";
import { activeTasks, effectiveGatePassNo, useStore } from "../lib/store";
import type { PickingTask } from "../lib/types";
import { gatePassBulkCsv, uniwareCsv } from "../lib/uniwareExport";
import { Button, Card, Tag } from "./Ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function roundLabel(round: number): string {
  if (round === 1) return "Original";
  if (round === 2) return "Not-Found Re-offer";
  return `Round ${round}`;
}

function FamilyRow({
  family,
  gatePassNo,
  createdByName,
  selectedRound,
  onSelectRound,
}: {
  family: PicklistFamily;
  gatePassNo?: string;
  createdByName?: string;
  selectedRound: number;
  onSelectRound: (round: number) => void;
}) {
  const active = family.rounds.find((r) => r.round === selectedRound) ?? family.rounds[family.rounds.length - 1];
  const hasAlternates = family.rounds.length > 1;
  const batches = [...new Set(active.lines.map((l) => l.batch))];
  const now = new Date();

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <span className="text-sm font-semibold">{gatePassNo ?? <span className="text-amber-700 dark:text-amber-400">Gate pass pending</span>}</span>
          <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">{family.taskNo} · {active.facility}</span>
        </div>
        {hasAlternates && (
          <div className="flex gap-1 rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800">
            {family.rounds.map((r) => (
              <button
                key={r.round}
                onClick={() => onSelectRound(r.round)}
                className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                  active.round === r.round ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {roundLabel(r.round)}
                {r.round === 1 && r.bad > 0 && <Tag tone="bad">short</Tag>}
              </button>
            ))}
          </div>
        )}
      </div>

      <table className="w-full border-collapse text-xs">
        <tbody>
          <tr className="text-slate-700 dark:text-slate-200">
            <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{active.no}</td>
            <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
              {timeLabel(active.createdAt ?? family.latestCreatedAt)}
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {ageDays(active.createdAt ?? family.latestCreatedAt, now)}d ago
              </div>
              {active.round === 1 && createdByName && <div className="text-[10px] text-slate-500 dark:text-slate-400">by {createdByName}</div>}
            </td>
            <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{active.lines.length} line(s)</td>
            <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
              <div className="flex flex-wrap gap-1">
                {batches.map((batch) => (
                  <Tag key={batch} tone="muted">{batch}</Tag>
                ))}
              </div>
            </td>
            <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
              <Tag tone={active.status === "completed" ? "ok" : "warn"}>{active.status}</Tag>
              {active.bad > 0 && <Tag tone="bad">{active.bad} not found</Tag>}
            </td>
            <td className="border-b border-slate-100 p-1.5 text-right dark:border-slate-700/60">
              <Button
                variant="sm"
                onClick={() => downloadCsv(uniwareCsv(active.lines, gatePassNo || active.no), `${gatePassNo || active.no}-${roundLabel(active.round).replace(/\s+/g, "_")}.csv`)}
              >
                CSV
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PicklistRepository({ tasks: tasksProp }: { tasks?: PickingTask[] } = {}) {
  const storeTasks = useStore((s) => s.tasks);
  const tasks = tasksProp ?? activeTasks(storeTasks);
  const [selectedRounds, setSelectedRounds] = useState<Record<string, number>>({});

  const taskByNo = new Map(tasks.map((t) => [t.no, t]));
  // Discarded facility picklists are a separate concept from archived tasks
  // (see FacilityPicklist.discarded) — drop them here so a discarded round
  // disappears from the Repository the same way an archived task already does.
  const tasksWithoutDiscarded = tasks
    .map((t) => ({ ...t, facilities: t.facilities.filter((f) => !f.discarded) }))
    .filter((t) => t.facilities.length > 0);
  const families = groupPicklistFamilies(tasksWithoutDiscarded);

  if (families.length === 0) {
    return (
      <Card title="Picklist repository">
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No picklists in this range.</p>
      </Card>
    );
  }

  return (
    <Card title="Picklist repository">
      <div className="mb-3 flex justify-end">
        <Button
          variant="sm"
          onClick={() =>
            downloadCsv(
              gatePassBulkCsv(
                families.flatMap((fam) => {
                  const r = fam.rounds.find((x) => x.round === (selectedRounds[fam.key] ?? fam.rounds[fam.rounds.length - 1].round)) ?? fam.rounds[fam.rounds.length - 1];
                  const gp = effectiveGatePassNo(fam.rounds[0], taskByNo.get(fam.taskNo)) ?? fam.taskNo;
                  return [{ gatePassNo: gp, lines: r.lines }];
                }),
              ),
              `gate_pass_bulk.csv`,
            )
          }
        >
          Bulk Gate Pass CSV
        </Button>
      </div>

      <div className="space-y-3">
        {families.map((fam) => {
          const t = taskByNo.get(fam.taskNo);
          return (
            <FamilyRow
              key={fam.key}
              family={fam}
              gatePassNo={effectiveGatePassNo(fam.rounds[0], t)}
              createdByName={t?.createdByName}
              selectedRound={selectedRounds[fam.key] ?? fam.rounds[fam.rounds.length - 1].round}
              onSelectRound={(round) => setSelectedRounds((prev) => ({ ...prev, [fam.key]: round }))}
            />
          );
        })}
      </div>
    </Card>
  );
}
