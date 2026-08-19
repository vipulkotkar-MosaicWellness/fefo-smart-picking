import type { Hold, StockRow } from "./types";

/** A stock lot's real-world identity — stable across stock re-syncs, unlike its internal rid. */
export function holdKey(sku: string, facility: string, bin: string, batch: string): string {
  return `${sku}::${facility}::${bin}::${batch}`;
}

/**
 * Current on-hand qty for the exact SKU+Facility+Bin+Batch a hold refers to
 * — so a hold shows both "10 not found" AND "842 on the shelf entirely
 * blocked by that", not just the shortfall in isolation.
 */
export function onHandQty(stock: StockRow[], sku: string, facility: string, bin: string, batch: string): number {
  return stock
    .filter((b) => b.sku === sku && b.location === facility && b.bin === bin && b.batch === batch)
    .reduce((sum, b) => sum + b.qty, 0);
}

/**
 * Keys for every hold not yet released — what allocate() checks against.
 * A hold whose lot has emptied out (0 current qty) gets actually released
 * (with an audit trail) by the auto-release sweep in store.ts rather than
 * being silently excluded here — see dueForHoldAutoRelease.
 */
export function activeHoldKeys(holds: Hold[]): Set<string> {
  return new Set(holds.filter((h) => !h.releasedAt).map((h) => holdKey(h.sku, h.facility, h.bin, h.batch)));
}

/**
 * Active holds whose lot currently has zero stock — nothing left there to
 * block, so keeping them listed adds no value. checkHoldAutoRelease() sweeps
 * this every minute and genuinely releases each one (releasedBy: "System"),
 * so it shows up in the release history / CSV export like any other release,
 * instead of just quietly disappearing. If the same lot resyncs with stock
 * and goes not-found again later, holdsToCreate() places a fresh hold then.
 */
export function dueForHoldAutoRelease(holds: Hold[], stock: StockRow[]): Hold[] {
  return holds.filter((h) => !h.releasedAt && onHandQty(stock, h.sku, h.facility, h.bin, h.batch) <= 0);
}

export interface NewHoldRequest {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number; // bin qty still on hold — the shelf's current qty AFTER the picked amount is deducted, not the not-found count
  reason?: string;
  sourceTaskNo: string;
}

/**
 * Which not-found lines from a just-completed facility picklist need a new
 * hold — one per distinct SKU+Bin+Batch, skipping anything already actively
 * held so a repeat completion doesn't create duplicate rows.
 *
 * The hold's qty is the bin's current stock level (via onHandQty), NOT the
 * not-found count. Worked example: bin qty 100, pick qty 10, picked 5,
 * not-found 5 -> hold qty is 95 (100 - 5 picked), because `stock` here is
 * expected to already have the picked amount deducted (applyPicks() does
 * this before calling holdsToCreate) — so reading it straight off gives the
 * right number without double-subtracting.
 */
export function holdsToCreate(
  lines: { sku: string; bin: string; batch: string; nf?: number; nfReason?: string }[],
  facility: string,
  sourceTaskNo: string,
  existingActiveKeys: Set<string>,
  stock: StockRow[],
): NewHoldRequest[] {
  const seen = new Set<string>();
  const out: NewHoldRequest[] = [];
  for (const l of lines) {
    if (!l.nf || l.nf <= 0) continue;
    const key = holdKey(l.sku, facility, l.bin, l.batch);
    if (existingActiveKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ sku: l.sku, facility, bin: l.bin, batch: l.batch, qty: onHandQty(stock, l.sku, facility, l.bin, l.batch), reason: l.nfReason, sourceTaskNo });
  }
  return out;
}
