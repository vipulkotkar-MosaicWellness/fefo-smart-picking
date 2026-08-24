import { supabase } from "./supabaseClient";

export interface AdherenceLine {
  sku: string;
  name?: string;
  bin: string;
  batch: string;
  instructed_qty: number;
  actual_qty: number;
  compliant_qty: number;
  status: "OK" | "PARTIAL" | "BIN BREACH";
  /** Every bin/batch this SKU was actually picked from in this gate pass — where the picker really went. */
  picked_bin_batch?: string;
}

export interface GatepassAdherence {
  gatepass_code: string;
  facility: string;
  report_date: string; // YYYY-MM-DD
  instructed_qty: number;
  compliant_qty: number;
  adherence_pct: number;
  lines: AdherenceLine[];
}

/** Rows for the last `days` report dates — populated daily by GatepassAdherenceCheck.gs. */
export async function fetchGatepassAdherence(days = 30): Promise<GatepassAdherence[]> {
  if (!supabase) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("gatepass_adherence")
    .select("gatepass_code,facility,report_date,instructed_qty,compliant_qty,adherence_pct,lines")
    .gte("report_date", sinceIso)
    .order("report_date", { ascending: false })
    .order("adherence_pct", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GatepassAdherence[];
}
