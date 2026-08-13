import type { FacilityPicklist } from "./types";

export interface QueueMetrics {
  openCount: number;
  unassignedCount: number;
  exceptionCount: number;
  /** null when nothing has completed yet — showing 0% would misleadingly read as "failing". */
  fillRatePct: number | null;
}

/** Metrics computed only from what the data actually records — no invented priority/SLA numbers. */
export function queueMetrics(facilities: FacilityPicklist[]): QueueMetrics {
  const open = facilities.filter((f) => f.status !== "completed");
  const unassigned = open.filter((f) => !f.lines.some((l) => l.picker));
  const exceptions = facilities.filter((f) => f.bad > 0 || f.lines.some((l) => (l.nf ?? 0) > 0));

  const completed = facilities.filter((f) => f.status === "completed");
  const demanded = completed.reduce((s, f) => s + f.lines.reduce((x, l) => x + l.qty, 0), 0);
  const picked = completed.reduce((s, f) => s + f.lines.reduce((x, l) => x + (l.picked ?? 0), 0), 0);

  return {
    openCount: open.length,
    unassignedCount: unassigned.length,
    exceptionCount: exceptions.length,
    fillRatePct: demanded > 0 ? Math.round((picked / demanded) * 1000) / 10 : null,
  };
}

export type QueueBucket = "creation" | "picking" | "blocked" | "exception" | "done";

/** Which of the five Picking Supervisor queue buckets a picklist belongs in. */
export function queueBucket(f: FacilityPicklist): QueueBucket {
  if (f.status === "completed") return f.bad > 0 ? "exception" : "done";
  if (f.wmsBlocked) return "blocked";
  return f.lines.some((l) => l.picker) ? "picking" : "creation";
}

export interface BucketSummary {
  picklistCount: number;
  lineCount: number;
  unitCount: number;
  pickedUnits: number;
  pendingUnits: number;
}

/**
 * Aggregate stats for a collapsed bucket header — enough for a supervisor to
 * gauge scale at a glance without expanding every picklist in it.
 * "Pending" means not yet actioned at all (line.picked == null); a line
 * that's already resolved with some not-found quantity isn't "pending" —
 * that outcome is recorded, just not counted as still-picked units.
 */
export function bucketSummary(items: FacilityPicklist[]): BucketSummary {
  let lineCount = 0;
  let unitCount = 0;
  let pickedUnits = 0;
  let pendingUnits = 0;
  for (const f of items) {
    for (const l of f.lines) {
      lineCount++;
      unitCount += l.qty;
      if (l.picked == null) pendingUnits += l.qty;
      else pickedUnits += l.picked;
    }
  }
  return { picklistCount: items.length, lineCount, unitCount, pickedUnits, pendingUnits };
}

export interface PickerWorkload {
  picker: string;
  activeLines: number;
}

/** How many not-yet-picked lines are currently assigned to each picker, across open picklists. */
export function pickerWorkload(facilities: FacilityPicklist[], pickers: string[]): PickerWorkload[] {
  const open = facilities.filter((f) => f.status !== "completed");
  return pickers.map((picker) => ({
    picker,
    activeLines: open.reduce((s, f) => s + f.lines.filter((l) => l.picker === picker && l.picked == null).length, 0),
  }));
}
