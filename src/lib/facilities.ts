// Default facility display order — allocation itself is pure FEFO across
// every facility (see allocateAcrossFacilities in store.ts); this only
// controls the order facilities are listed in on screen.
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

// Every real gate pass number for a facility starts with this prefix — used
// to reconcile a Planner-supplied gate pass against the facility it's
// actually for (see reconcileGatePasses in store.ts), and to validate a
// manually-entered one. Facility names not listed here have no gate pass
// prefix convention yet — treated as "any prefix accepted" until one exists.
export const FACILITY_GATE_PASS_PREFIX: Record<string, string> = {
  "SL Ambient": "GPSLAMB",
  "SL Mother Hub": "GPSLMH",
  "SL RX": "GPOBSL",
};

/** Does this gate pass number's prefix match the facility it's being applied to? */
export function gatePassMatchesFacility(gatePassNo: string, facility: string): boolean {
  const prefix = FACILITY_GATE_PASS_PREFIX[facility];
  if (!prefix) return true; // no known convention for this facility — don't block it
  return gatePassNo.trim().toUpperCase().startsWith(prefix);
}

/** Which facility a gate pass number's prefix indicates, if any of the known ones match. */
export function facilityForGatePass(gatePassNo: string): string | undefined {
  const upper = gatePassNo.trim().toUpperCase();
  return Object.keys(FACILITY_GATE_PASS_PREFIX).find((f) => upper.startsWith(FACILITY_GATE_PASS_PREFIX[f]));
}
