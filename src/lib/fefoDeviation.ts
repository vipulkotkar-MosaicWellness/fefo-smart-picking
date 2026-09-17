// src/lib/fefoDeviation.ts
import type { PickLine } from "./types";

export interface FefoDeviationLine {
  sku: string;
  bin: string;
  batch: string;
  /** Units sourced from this lot under case-first beyond what strict FEFO would have used. */
  deviationQty: number;
}

/**
 * Compares the real case-first allocation against what strict FEFO would
 * have picked for the same demand on the same stock snapshot, both already
 * computed for one facility (caller passes `allocate()`'s own PickLine[]
 * output for each mode — see generate() in store.ts for how they're
 * produced side by side). Returns only lots where case-first took MORE than
 * strict FEFO would have — the "breach" side of the diff. The matching
 * "took less" side (e.g. loose eaches left behind) is implied: the two
 * sides always sum to the same total units, so reporting one side is
 * enough to know the full deviation amount without double-reporting it.
 */
export function computeFefoDeviation(caseBasedLines: PickLine[], strictFefoLines: PickLine[]): FefoDeviationLine[] {
  function byLot(lines: PickLine[]): Map<string, { sku: string; bin: string; batch: string; qty: number }> {
    const map = new Map<string, { sku: string; bin: string; batch: string; qty: number }>();
    for (const l of lines) {
      const key = `${l.sku}::${l.bin}::${l.batch}`;
      const cur = map.get(key) ?? { sku: l.sku, bin: l.bin, batch: l.batch, qty: 0 };
      cur.qty += l.qty;
      map.set(key, cur);
    }
    return map;
  }

  const caseBasedByLot = byLot(caseBasedLines);
  const fefoByLot = byLot(strictFefoLines);

  const out: FefoDeviationLine[] = [];
  for (const [key, lot] of caseBasedByLot) {
    const fefoQty = fefoByLot.get(key)?.qty ?? 0;
    const deviationQty = lot.qty - fefoQty;
    if (deviationQty > 0) out.push({ sku: lot.sku, bin: lot.bin, batch: lot.batch, deviationQty });
  }
  return out;
}
