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
  /** Manufacturer's vendor batch number(s) for whatever was actually picked — distinct from the Uniware batch code. */
  vendor_batch?: string;
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

export interface LatestDayAdherence {
  report_date: string;
  gatepass_count: number;
  instructed_qty: number;
  compliant_qty: number;
  adherence_pct: number;
}

/** Aggregate adherence % for the most recent report_date that's actually been scored (usually yesterday). */
export async function fetchLatestDayAdherence(): Promise<LatestDayAdherence | null> {
  const rows = await fetchGatepassAdherence(7);
  if (rows.length === 0) return null;
  const latestDate = rows.reduce((max, r) => (r.report_date > max ? r.report_date : max), rows[0].report_date);
  const dayRows = rows.filter((r) => r.report_date === latestDate);
  const instructed_qty = dayRows.reduce((s, r) => s + r.instructed_qty, 0);
  const compliant_qty = dayRows.reduce((s, r) => s + r.compliant_qty, 0);
  return {
    report_date: latestDate,
    gatepass_count: dayRows.length,
    instructed_qty,
    compliant_qty,
    adherence_pct: instructed_qty ? Math.round((compliant_qty / instructed_qty) * 10000) / 100 : 0,
  };
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
