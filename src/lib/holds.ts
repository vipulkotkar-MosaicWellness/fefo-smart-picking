import type { Hold, StockRow } from "./types";

/** A stock lot's real-world identity — stable across stock re-syncs, unlike its internal rid. */
export function holdKey(sku: string, facility: string, bin: string, batch: string): string {
  return `${sku}::${facility}::${bin}::${batch}`;
}

/** Keys for every hold not yet released — what allocate() checks against. */
export function activeHoldKeys(holds: Hold[]): Set<string> {
  return new Set(holds.filter((h) => !h.releasedAt).map((h) => holdKey(h.sku, h.facility, h.bin, h.batch)));
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

export interface NewHoldRequest {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number; // total not-found quantity that triggered this hold
  reason?: string;
  sourceTaskNo: string;
}

/**
 * Which not-found lines from a just-completed facility picklist need a new
 * hold — one per distinct SKU+Bin+Batch, skipping anything already actively
 * held so a repeat completion doesn't create duplicate rows. Two not-found
 * lines that share the same combination (e.g. split across a round-2 offer)
 * have their not-found qty summed into the one hold.
 */
export function holdsToCreate(
  lines: { sku: string; bin: string; batch: string; nf?: number; nfReason?: string }[],
  facility: string,
  sourceTaskNo: string,
  existingActiveKeys: Set<string>,
): NewHoldRequest[] {
  const byKey = new Map<string, NewHoldRequest>();
  for (const l of lines) {
    if (!l.nf || l.nf <= 0) continue;
    const key = holdKey(l.sku, facility, l.bin, l.batch);
    if (existingActiveKeys.has(key)) continue;
    const existing = byKey.get(key);
    if (existing) existing.qty += l.nf;
    else byKey.set(key, { sku: l.sku, facility, bin: l.bin, batch: l.batch, qty: l.nf, reason: l.nfReason, sourceTaskNo });
  }
  return [...byKey.values()];
}
