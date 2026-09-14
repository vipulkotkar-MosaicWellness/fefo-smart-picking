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

export type QueueBucket = "picking" | "blocked" | "exception" | "done";

/**
 * Which of the four Picking Supervisor queue buckets a picklist belongs in.
 * "picking" covers everything still open and not yet WMS-blocked, whether or
 * not a picker has been assigned yet — creation-pending and picking-pending
 * used to be shown as two separate buckets, but both are the same underlying
 * "not done yet" state from a supervisor's point of view, so they're merged
 * into one "Picking Pending" bucket. Use pickerWorkload/the unassignedCount
 * metric if you need to know how many still need a picker.
 */
export function queueBucket(f: FacilityPicklist): QueueBucket {
  if (f.status === "completed") return f.bad > 0 ? "exception" : "done";
  if (f.wmsBlocked) return "blocked";
  return "picking";
}

/**
 * Open picklists ranked "what a supervisor should look at first": unassigned
 * (nobody has a picker on any line) ahead of assigned-but-still-open ones,
 * oldest first within each group. This is deliberately flat and independent
 * of pipeline stage (queueBucket) — an unassigned picklist that's been
 * sitting for days can be buried inside ANY of the 4 stage buckets (Picking
 * Pending, WMS Blocked, etc.) with no way to spot it without opening each
 * one individually. This list is the shortcut; the stage buckets remain the
 * full, complete picture.
 */
export function needsAttentionList(facilities: FacilityPicklist[], tasks: { no: string; createdAt: string }[]): FacilityPicklist[] {
  const createdAtOf = (f: FacilityPicklist): string =>
    f.createdAt ?? tasks.find((t) => t.no === f.taskNo)?.createdAt ?? new Date(0).toISOString();
  const open = facilities.filter((f) => f.status !== "completed");
  return [...open].sort((a, b) => {
    const aUnassigned = !a.lines.some((l) => l.picker);
    const bUnassigned = !b.lines.some((l) => l.picker);
    if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
    return new Date(createdAtOf(a)).getTime() - new Date(createdAtOf(b)).getTime();
  });
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

/**
 * Case-insensitive match against everything a supervisor would actually
 * type in a hurry: the gate pass number, the facility/task picklist number,
 * the channel, or any line's SKU code/product name. An empty (or
 * whitespace-only) query matches everything, so the search box can double
 * as "no filter" when untouched.
 */
export function matchesSupervisorSearch(f: FacilityPicklist, channel: string, gatePassNo: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystacks = [f.no, f.taskNo, f.facility, channel, gatePassNo ?? "", ...f.lines.flatMap((l) => [l.sku, l.name])].map((h) => h.toLowerCase());
  return haystacks.some((h) => h.includes(q));
}
