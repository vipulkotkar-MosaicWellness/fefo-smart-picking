import { primaryFacilityNo } from "./format";
import type { FacilityPicklist, PickingTask } from "./types";

export interface PicklistFamily {
  key: string; // the round-1 facility picklist's own number
  taskNo: string;
  rounds: FacilityPicklist[]; // sorted ascending — [0] is always the original
  /** Most recent activity across every round — used to place the family in a date bucket. */
  latestCreatedAt: string;
}

/**
 * Groups a task's facility picklists by "family": the original (round 1)
 * plus any not-found re-offers raised against it (round 2+, same facility).
 * A supervisor thinks of these as one picklist with a follow-up, not two
 * unrelated entries — this is what lets the UI show them as one row with a
 * tab switch instead of the list growing a new row every time something
 * goes not-found again.
 */
export function groupPicklistFamilies(tasks: PickingTask[]): PicklistFamily[] {
  const families = new Map<string, PicklistFamily>();

  for (const t of tasks) {
    for (const f of t.facilities) {
      const key = f.round > 1 ? primaryFacilityNo(f.no) : f.no;
      let fam = families.get(key);
      if (!fam) {
        fam = { key, taskNo: t.no, rounds: [], latestCreatedAt: t.createdAt };
        families.set(key, fam);
      }
      fam.rounds.push(f);
      const roundTime = f.createdAt ?? t.createdAt;
      if (new Date(roundTime).getTime() > new Date(fam.latestCreatedAt).getTime()) {
        fam.latestCreatedAt = roundTime;
      }
    }
  }

  for (const fam of families.values()) fam.rounds.sort((a, b) => a.round - b.round);
  return [...families.values()];
}
