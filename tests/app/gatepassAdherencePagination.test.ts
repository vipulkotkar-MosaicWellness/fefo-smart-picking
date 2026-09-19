import { beforeEach, describe, expect, it, vi } from "vitest";

let pages: { data: unknown[] }[] = [];
const rangeCalls: [number, number][] = [];
const filters: { method: string; args: unknown[] }[] = [];

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const record = (method: string) => vi.fn((...args: unknown[]) => {
    filters.push({ method, args });
    return chain;
  });
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = record(m);
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    return Promise.resolve({ data: pages[rangeCalls.length - 1]?.data ?? [], error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: pages[0]?.data ?? [], error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn(() => queryBuilder()) },
}));

function adherenceRow(code: string, pct: number) {
  return {
    gatepass_code: code,
    facility: "SL Mother Hub",
    report_date: "2026-09-16",
    instructed_qty: 100,
    compliant_qty: Math.round(pct),
    adherence_pct: pct,
    lines: [],
  };
}

describe("fetchGatepassAdherence — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
    filters.length = 0;
  });

  it("returns every scored gate pass, including the high-adherence tail past row 1000", async () => {
    const { fetchGatepassAdherence } = await import("../../src/lib/gatepassAdherenceSupabase");

    const firstPage = Array.from({ length: 1000 }, (_, i) => adherenceRow(`GPSLMH${10000 + i}`, 40 + i / 100));
    const secondPage = [adherenceRow("GPSLMH99999", 100)]; // a perfect-score gate pass, trimmed today
    pages = [{ data: firstPage }, { data: secondPage }];

    const rows = await fetchGatepassAdherence(30);

    expect(rows).toHaveLength(1001);
    expect(rows.map((r) => r.gatepass_code)).toContain("GPSLMH99999");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("keeps the used_for_performance and report_date filters and both sorts", async () => {
    const { fetchGatepassAdherence } = await import("../../src/lib/gatepassAdherenceSupabase");
    pages = [{ data: [adherenceRow("GPSLMH10000", 88)] }];

    await fetchGatepassAdherence(7);

    expect(filters.some((f) => f.method === "eq" && f.args[0] === "used_for_performance" && f.args[1] === true)).toBe(true);
    expect(filters.some((f) => f.method === "gte" && f.args[0] === "report_date")).toBe(true);
    expect(filters.filter((f) => f.method === "order").map((f) => f.args[0])).toEqual(["report_date", "adherence_pct"]);
  });
});
