// Facility priority for the waterfall allocation.
// Demand is filled in this order: Mother Hub first, then Ambient, then RX.
export const FACILITY_PRIORITY = ["SL Mother Hub", "SL Ambient", "SL RX"];

export const FACILITY_CODE: Record<string, string> = {
  "SL Mother Hub": "MH",
  "SL Ambient": "AMB",
  "SL RX": "RX",
};

export function facilityCode(f: string): string {
  return FACILITY_CODE[f] ?? f.replace(/\s+/g, "").slice(0, 3).toUpperCase();
}

export function facilityRank(f: string): number {
  const i = FACILITY_PRIORITY.indexOf(f);
  return i < 0 ? 99 : i;
}
