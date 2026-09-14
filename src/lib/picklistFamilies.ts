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
    const byNo = new Map(t.facilities.map((f) => [f.no, f] as const));
    // Follows the reofferedFrom chain back to the root (round 1, or as far
    // back as the chain goes) when present. A round-3 re-offer's
    // reofferedFrom points at round 2, not round 1 directly, so this
    // recurses. Falls back to the old same-facility-suffix guess
    // (primaryFacilityNo) for round 1 itself, and for any round whose
    // reofferedFrom is missing or points somewhere unresolvable (historical
    // data from before this field existed, or malformed/corrupted data) —
    // the `visited` set guards against a cycle of any length (not just
    // direct self-reference) so a corrupted chain can't recurse forever.
    const rootKeyOf = (f: FacilityPicklist, visited = new Set<string>()): string => {
      if (f.round <= 1) return f.no;
      if (visited.has(f.no)) return primaryFacilityNo(f.no);
      if (f.reofferedFrom) {
        const parent = byNo.get(f.reofferedFrom);
        if (parent && parent.no !== f.no) {
          visited.add(f.no);
          return rootKeyOf(parent, visited);
        }
      }
      return primaryFacilityNo(f.no);
    };

    for (const f of t.facilities) {
      const key = rootKeyOf(f);
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

/** Which family (if any) a specific facility picklist belongs to, from an already-computed family list. */
export function familyFor(f: FacilityPicklist, families: PicklistFamily[]): PicklistFamily | undefined {
  return families.find((fam) => fam.rounds.some((r) => r.no === f.no));
}
