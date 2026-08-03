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
