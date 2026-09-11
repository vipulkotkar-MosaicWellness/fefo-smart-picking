import { supabase } from "./supabaseClient";

/** Reasons emitted by apps-script/GatepassAdherenceCheck.gs — see its SCORING RULES header. */
export type AdherenceReason =
  | "Bin & batch match"
  | "Batch match, bin mismatch"
  | "Partial pick — correct batch"
  | "Non-expiry SKU"
  | "Batch mismatch"
  | "Not picked";

export interface AdherenceLine {
  sku: string;
  name?: string;
  bin: string;
  batch: string;
  instructed_qty: number;
  actual_qty: number;
  compliant_qty: number;
  /** "Yes" = FEFO was broken (wrong batch, or nothing picked). "No" = the instructed batch was picked (any shelf), or a non-expiry SKU. Shelf/bin mismatch alone is NOT a breach. */
  fefo_breach: "Yes" | "No";
  /** Why — shown even when fefo_breach is "No", so shelf mismatches and partial picks stay visible. */
  reason: AdherenceReason;
  /** Was any of the instructed batch picked from the instructed bin — for the (later) shelf-level adherence report. */
  bin_match?: "Yes" | "No";
  /** Every bin/batch this SKU was actually picked from in this gate pass — where the picker really went. */
  picked_bin_batch?: string;
  /** Manufacturer's vendor batch number(s) for whatever was actually picked — distinct from the Uniware batch code. */
  vendor_batch?: string;
  /** @deprecated pre-Sep-2026 rows only (bin+batch scoring). Use `fefo_breach` + `reason`. */
  status?: "OK" | "PARTIAL" | "BIN BREACH";
}

/** Breach flag from a line of either shape — new (`fefo_breach`) or a pre-Sep-2026 row still on `status`. */
export function lineBreach(line: AdherenceLine): "Yes" | "No" {
  if (line.fefo_breach) return line.fefo_breach;
  return line.status === "OK" || line.status === "PARTIAL" ? "No" : "Yes";
}

/** Reason from a line of either shape. Old `status` maps: OK→match, PARTIAL→partial pick, BIN BREACH→batch mismatch. */
export function lineReason(line: AdherenceLine): string {
  if (line.reason) return line.reason;
  if (line.status === "PARTIAL") return "Partial pick — correct batch";
  if (line.status === "BIN BREACH") return "Batch mismatch";
  return "Bin & batch match";
}

/** Row tint: a breach is "bad"; a partial pick or shelf mismatch is "warn"; otherwise "ok". */
export function lineTone(line: AdherenceLine): "ok" | "warn" | "bad" {
  if (lineBreach(line) === "Yes") return "bad";
  const reason = lineReason(line);
  if (reason === "Partial pick — correct batch" || reason === "Batch match, bin mismatch") return "warn";
  return "ok";
}

export interface GatepassAdherence {
  gatepass_code: string;
  facility: string;
  report_date: string; // YYYY-MM-DD
  instructed_qty: number;
  compliant_qty: number;
  adherence_pct: number;
  lines: AdherenceLine[];
  /**
   * A gate pass can be touched more than once in Uniware (RETURN_AWAITED
   * when picking finishes, CLOSED later when the receipt is reviewed) —
   * every touch gets its own row for a full audit trail, but only the
   * EARLIEST is used_for_performance = true. fetchGatepassAdherence()
   * below already filters to true-only, so every screen reading through it
   * sees each gate pass exactly once; this field exists mainly so a future
   * "show all touches" audit view has something to filter on.
   */
  used_for_performance?: boolean;
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
    .eq("used_for_performance", true)
    .gte("report_date", sinceIso)
    .order("report_date", { ascending: false })
    .order("adherence_pct", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GatepassAdherence[];
}
