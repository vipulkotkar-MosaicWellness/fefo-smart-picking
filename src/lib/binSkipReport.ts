import type { PickingTask } from "./types";

/** One skipped bin+batch lot, with the picklist context that produced it. */
export interface BinSkipEntry {
  taskNo: string;
  gatePassNo: string;
  channel: string;
  createdAt: string;
  sku: string;
  name: string;
  facility: string;
  bin: string;
  batch: string;
  qtyAvailable: number;
  threshold: number;
}

/** Flattens every task's recorded binSkips into one list, newest first. */
export function binSkipReport(tasks: PickingTask[]): BinSkipEntry[] {
  return tasks
    .flatMap((t) =>
      (t.binSkips ?? []).map((s) => ({
        taskNo: t.no,
        gatePassNo: t.gatePassNo,
        channel: t.channel,
        createdAt: t.createdAt,
        ...s,
      })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
