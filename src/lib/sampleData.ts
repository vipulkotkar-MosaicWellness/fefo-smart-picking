import type { StockRow } from "./types";

// [Location, Bin, SKU Code, SKU Name, Batch, Expiry(YYYY-MM), Qty, Shelf months, Type, Active]
export type StockTuple = [string, string, string, string, string, string, number, number, string, string];

export const SAMPLE_STOCK: StockTuple[] = [
  ["SL Mother Hub", "SLM-A1", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2411", "2026-11", 40, 24, "Good", "Active"],
  ["SL Mother Hub", "SLM-B3", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2709", "2027-09", 60, 24, "Good", "Active"],
  ["SL Mother Hub", "SLM-A2", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2802", "2028-02", 50, 24, "Good", "Active"],
  ["SL Mother Hub", "SLM-C2", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2805", "2028-05", 30, 24, "Damaged", "Active"],
  ["SL Mother Hub", "SLM-D1", "MWMMHRP.0004.AAAA.B0_N", "MM Hair Gummies 30mcg - 30s", "GM-2609", "2026-09", 25, 18, "Good", "Active"],
  ["SL Mother Hub", "SLM-B1", "MWMMHRP.0004.AAAA.B0_N", "MM Hair Gummies 30mcg - 30s", "GM-2706", "2027-06", 35, 18, "Good", "Active"],
  ["SL Mother Hub", "SLM-C1", "MWMMHRP.0004.AAAA.B0_N", "MM Hair Gummies 30mcg - 30s", "GM-2712", "2027-12", 45, 18, "Good", "Active"],
  ["SL Mother Hub", "SLM-A3", "MWMMHRP.0006.AAAA.B0_R", "MM Minoxidil 5% - 60 ml", "MX-2701", "2027-01", 30, 24, "Good", "Active"],
  ["SL Mother Hub", "SLM-B2", "MWMMHRP.0006.AAAA.B0_R", "MM Minoxidil 5% - 60 ml", "MX-2801", "2028-01", 50, 24, "Good", "Active"],
  ["SL Ambient", "SLA-B1", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2807", "2028-07", 20, 24, "Good", "Active"],
  ["SL Ambient", "SLA-A1", "MWMMHRP.0006.AAAA.B0_R", "MM Minoxidil 5% - 60 ml", "MX-2806", "2028-06", 40, 24, "Good", "Active"],
  ["SL RX", "SLR-A1", "MWMMHRP.0001.AAAA.B0_N", "MM DHT Blocking Shampoo - 200 ml", "SH-2810", "2028-10", 40, 24, "Good", "Active"],
  ["SL RX", "SLR-B1", "MWMMHRP.0004.AAAA.B0_N", "MM Hair Gummies 30mcg - 30s", "GM-2803", "2028-03", 30, 18, "Good", "Active"],
  ["SL RX", "SLR-A2", "MWMMHRP.0006.AAAA.B0_R", "MM Minoxidil 5% - 60 ml", "MX-2711", "2027-11", 25, 24, "Good", "Active"],
];

/** Turn raw tuples (from sample or a parsed CSV) into StockRow[] with fresh rids. */
export function rowsFromTuples(tuples: StockTuple[]): StockRow[] {
  let rid = 0;
  return tuples.map((t) => {
    const [location, bin, sku, name, batch, exp, qty, shelf, type, active] = t;
    const [y, m] = String(exp).split("-").map(Number);
    return {
      rid: ++rid,
      location,
      bin,
      sku,
      name,
      batch,
      exp: [y, m] as [number, number],
      qty: Number(qty),
      shelf: Number(shelf),
      type,
      active,
    };
  });
}

/** Parse pasted / uploaded stock CSV text into tuples (header row auto-skipped). */
export function parseStockCsv(text: string): StockTuple[] {
  const out: StockTuple[] = [];
  text
    .trim()
    .split(/\r?\n/)
    .forEach((ln) => {
      if (!ln.trim()) return;
      const c = ln.split(",").map((s) => s.trim());
      if (/location/i.test(c[0]) && /sku/i.test(ln)) return; // header
      if (c.length < 10) return;
      out.push([
        c[0], c[1], c[2], c[3], c[4], c[5],
        Number(c[6]), Number(c[7]), c[8], c[9],
      ]);
    });
  return out;
}

/** Parse multi-channel demand CSV text (Channel, SKU Code, Qty). */
export function parseDemandCsv(
  text: string,
  known: Record<string, unknown>,
  knownChannels: Record<string, unknown>,
): {
  demand: { channel: string; sku: string; qty: number }[];
  badSku: string[];
  badChannel: string[];
  badQty: string[];
  duplicatesMerged: string[];
} {
  const demand: { channel: string; sku: string; qty: number }[] = [];
  const badSku: string[] = [];
  const badChannel: string[] = [];
  const badQty: string[] = [];
  const duplicatesMerged: string[] = [];
  text
    .trim()
    .split(/\r?\n/)
    .forEach((ln) => {
      if (!ln.trim()) return;
      const c = ln.split(",").map((s) => s.trim());
      if (/channel/i.test(c[0]) && /sku/i.test(ln)) return; // header
      if (c.length < 3) return;
      const channel = c[0];
      const sku = c[1];
      const qty = parseInt(c[2], 10);
      if (!(channel in knownChannels)) {
        badChannel.push(channel);
        return;
      }
      if (!(sku in known)) {
        badSku.push(sku);
        return;
      }
      if (!qty || qty < 1) {
        badQty.push(`${channel} / ${sku}`);
        return;
      }
      const ex = demand.find((d) => d.channel === channel && d.sku === sku);
      if (ex) {
        ex.qty += qty;
        const key = `${channel} / ${sku}`;
        if (!duplicatesMerged.includes(key)) duplicatesMerged.push(key);
      } else {
        demand.push({ channel, sku, qty });
      }
    });
  return { demand, badSku, badChannel, badQty, duplicatesMerged };
}
