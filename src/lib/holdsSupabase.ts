import { supabase } from "./supabaseClient";
import type { Hold } from "./types";

interface HoldRow {
  id: number;
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number;
  held_at: string;
  held_by: string;
  reason: string | null;
  source_task_no: string | null;
  released_at: string | null;
  released_by: string | null;
}

function fromRow(r: HoldRow): Hold {
  return {
    id: r.id,
    sku: r.sku,
    facility: r.facility,
    bin: r.bin,
    batch: r.batch,
    qty: r.qty,
    heldAt: r.held_at,
    heldBy: r.held_by,
    reason: r.reason ?? undefined,
    sourceTaskNo: r.source_task_no ?? undefined,
    releasedAt: r.released_at ?? undefined,
    releasedBy: r.released_by ?? undefined,
  };
}

/** Every hold, active and released — callers filter for active client-side. */
export async function fetchHolds(): Promise<Hold[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("stock_holds").select("*").order("held_at", { ascending: false });
  if (error) throw error;
  return (data as HoldRow[]).map(fromRow);
}

export interface NewHold {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number;
  heldBy: string;
  reason?: string;
  sourceTaskNo?: string;
}

export async function insertHold(h: NewHold): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("stock_holds").insert({
    sku: h.sku,
    facility: h.facility,
    bin: h.bin,
    batch: h.batch,
    qty: h.qty,
    held_by: h.heldBy,
    reason: h.reason ?? null,
    source_task_no: h.sourceTaskNo ?? null,
  });
  if (error) throw error;
}

export async function releaseHoldRow(id: number, releasedBy: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("stock_holds")
    .update({ released_at: new Date().toISOString(), released_by: releasedBy })
    .eq("id", id);
  if (error) throw error;
}
