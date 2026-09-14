import type { PicklistFamily } from "../lib/picklistFamilies";
import { Tag } from "./Ui";

export function roundLabel(round: number): string {
  if (round === 1) return "Original";
  return `Round ${round}`;
}

/**
 * Round-history tab switcher for a picklist family — Original / Round 2 /
 * Round 3..., each labeled with its own facility so a facility change
 * between rounds is visible just by reading across the tabs, no click
 * required. Shared between Picklist Repository and Picking Supervisor —
 * same component, same behavior, so a supervisor sees exactly what an
 * auditor looking at Repository would see for the same gate pass.
 *
 * Deliberately restrained colors: one accent (teal) for the selected tab,
 * neutral gray/white for the rest, and a single small amber dot as the
 * only additional marker — meaning "this round's facility differs from the
 * previous round's," not a new color per state.
 */
export function RoundTabs({
  family,
  selectedRound,
  onSelectRound,
}: {
  family: PicklistFamily;
  selectedRound: number;
  onSelectRound: (round: number) => void;
}) {
  if (family.rounds.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800">
      {family.rounds.map((r, i) => {
        const prev = family.rounds[i - 1];
        const facilityChanged = i > 0 && prev.facility !== r.facility;
        return (
          <button
            key={r.round}
            onClick={() => onSelectRound(r.round)}
            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
              selectedRound === r.round ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {roundLabel(r.round)} · {r.facility}
            {facilityChanged && (
              <span className="ml-1 text-amber-500" title="Moved to a different facility than the previous round">●</span>
            )}
            {r.round === 1 && r.bad > 0 && <Tag tone="bad">short</Tag>}
          </button>
        );
      })}
    </div>
  );
}
