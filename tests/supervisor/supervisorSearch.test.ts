import { describe, expect, it } from "vitest";
import { matchesSupervisorSearch } from "../../src/lib/supervisorMetrics";
import type { FacilityPicklist } from "../../src/lib/types";

const f: FacilityPicklist = {
  no: "REPL-INTERNALSTOC-260912-001-MH",
  taskNo: "REPL-INTERNALSTOC-260912-001",
  facility: "SL Mother Hub",
  status: "open",
  round: 1,
  bad: 0,
  lines: [{ rid: 1, sku: "MWBWSKP.00648.B0_N", name: "BB 10% Urea Lotion", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
};

describe("matchesSupervisorSearch", () => {
  it("matches on gate pass number, case-insensitively", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", "GPSLMH-TESTREPRO01", "gpslmh-testrepro01")).toBe(true);
  });

  it("matches on the facility picklist number", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "internalstoc-260912")).toBe(true);
  });

  it("matches on a line's SKU code", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "MWBWSKP.00648")).toBe(true);
  });

  it("matches on a line's product name", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "urea lotion")).toBe(true);
  });

  it("matches on channel", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "internal stock")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "zzz-no-match")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "")).toBe(true);
  });

  it("a whitespace-only query matches everything", () => {
    expect(matchesSupervisorSearch(f, "Internal Stock Transfer", undefined, "   ")).toBe(true);
  });

  it("matches on a line's SKU in multi-line picklist (only 2nd line matches)", () => {
    const multiLine: FacilityPicklist = {
      no: "PKL-001",
      taskNo: "TASK-001",
      facility: "SL Mother Hub",
      status: "open",
      round: 1,
      bad: 0,
      lines: [
        { rid: 1, sku: "AAAA.00001", name: "Product A", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 10, qty: 5 },
        { rid: 2, sku: "MWBWSKP.00648.B0_N", name: "BB 10% Urea Lotion", facility: "SL Mother Hub", bin: "B2", batch: "B2", exp: [2099, 1], rem: 8, qty: 3 },
      ],
    };
    expect(matchesSupervisorSearch(multiLine, "Internal Stock Transfer", undefined, "MWBWSKP.00648")).toBe(true);
  });
});
