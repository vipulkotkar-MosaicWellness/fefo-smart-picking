import type { Hold } from "./types";

/** A stock lot's real-world identity — stable across stock re-syncs, unlike its internal rid. */
export function holdKey(sku: string, facility: string, bin: string, batch: string): string {
  return `${sku}::${facility}::${bin}::${batch}`;
}

/** Keys for every hold not yet released — what allocate() checks against. */
export function activeHoldKeys(holds: Hold[]): Set<string> {
  return new Set(holds.filter((h) => !h.releasedAt).map((h) => holdKey(h.sku, h.facility, h.bin, h.batch)));
}

export interface NewHoldRequest {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  reason?: string;
  sourceTaskNo: string;
}

/**
 * Which not-found lines from a just-completed facility picklist need a new
 * hold — one per distinct SKU+Bin+Batch, skipping anything already actively
 * held so a repeat completion doesn't create duplicate rows.
 */
export function holdsToCreate(
  lines: { sku: string; bin: string; batch: string; nf?: number; nfReason?: string }[],
  facility: string,
  sourceTaskNo: string,
  existingActiveKeys: Set<string>,
): NewHoldRequest[] {
  const seen = new Set<string>();
  const out: NewHoldRequest[] = [];
  for (const l of lines) {
    if (!l.nf || l.nf <= 0) continue;
    const key = holdKey(l.sku, facility, l.bin, l.batch);
    if (existingActiveKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ sku: l.sku, facility, bin: l.bin, batch: l.batch, reason: l.nfReason, sourceTaskNo });
  }
  return out;
}
