import { supabase } from "./supabaseClient";
import type { FefoDeviationLine } from "./fefoDeviation";

export interface FefoDeviationRow {
  gate_pass_no: string | null;
  facility: string;
  sku: string;
  bin: string;
  batch: string;
  deviation_qty: number;
  created_at: string;
}

/**
 * Logs one row per deviation line for a single facility's picklist — called
 * from generate() for a REAL order only, right alongside case-size gap
 * logging. `gatePassNo` is whatever generate() already resolved for this
 * facility at creation time (possibly none yet — see the table's own
 * comment on gate_pass_no).
 */
export async function logFefoDeviations(facility: string, gatePassNo: string | undefined, lines: FefoDeviationLine[]): Promise<void> {
  if (!supabase || lines.length === 0) return;
  const rows = lines.map((l) => ({
    gate_pass_no: gatePassNo ?? null,
    facility,
    sku: l.sku,
    bin: l.bin,
    batch: l.batch,
    deviation_qty: l.deviationQty,
  }));
  const { error } = await supabase.from("fefo_deviations").insert(rows);
  if (error) throw error;
}

/** Rows created on or after `sinceDate` (YYYY-MM-DD) — the reporting screen filters to whatever window it's showing. */
export async function fetchFefoDeviations(sinceDate: string): Promise<FefoDeviationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("fefo_deviations").select("gate_pass_no,facility,sku,bin,batch,deviation_qty,created_at").gte("created_at", sinceDate);
  if (error) throw error;
  return (data ?? []) as FefoDeviationRow[];
}
