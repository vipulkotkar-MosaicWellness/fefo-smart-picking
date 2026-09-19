import { beforeEach, describe, expect, it, vi } from "vitest";

let pages: { data: unknown[] }[] = [];
const rangeCalls: [number, number][] = [];

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = vi.fn(self);
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

function holdRow(id: number, heldAt: string) {
  return {
    id,
    sku: `SKU-${id}`,
    facility: "SL Mother Hub",
    bin: "R7-C19-002",
    batch: `BA${String(36161 + id)}`,
    qty: 12,
    held_at: heldAt,
    held_by: "Supervisor",
    reason: "Batch mismatch",
    source_task_no: "B2BE-BLINKIT-260101-001",
    released_at: null,
    released_by: null,
  };
}

describe("fetchHolds — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
  });

  it("returns every hold, including the oldest ones past row 1000", async () => {
    const { fetchHolds } = await import("../../src/lib/holdsSupabase");

    const firstPage = Array.from({ length: 1000 }, (_, i) => holdRow(i + 1, `2026-09-0${(i % 9) + 1}T10:00:00.000Z`));
    const secondPage = [holdRow(9999, "2025-11-04T10:00:00.000Z")]; // the genuinely oldest, still-active hold
    pages = [{ data: firstPage }, { data: secondPage }];

    const holds = await fetchHolds();

    expect(holds).toHaveLength(1001);
    expect(holds.map((h) => h.id)).toContain(9999);
    expect(holds.find((h) => h.id === 9999)!.heldAt).toBe("2025-11-04T10:00:00.000Z");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("still maps a single short page into Hold objects with camelCase fields", async () => {
    const { fetchHolds } = await import("../../src/lib/holdsSupabase");
    pages = [{ data: [holdRow(1, "2026-09-06T20:30:00.000Z")] }];

    const holds = await fetchHolds();

    expect(holds).toEqual([
      {
        id: 1,
        sku: "SKU-1",
        facility: "SL Mother Hub",
        bin: "R7-C19-002",
        batch: "BA36162",
        qty: 12,
        heldAt: "2026-09-06T20:30:00.000Z",
        heldBy: "Supervisor",
        reason: "Batch mismatch",
        sourceTaskNo: "B2BE-BLINKIT-260101-001",
        releasedAt: undefined,
        releasedBy: undefined,
      },
    ]);
    expect(rangeCalls).toEqual([[0, 999]]);
  });
});
