import { beforeEach, describe, expect, it, vi } from "vitest";

// PostgREST silently caps an un-ranged select at 1000 rows. `fetchStock` in
// supabaseStock.ts already pages past it; `fetchAllTasks` does not — and
// because it orders created_at ASCENDING, the rows it silently drops are the
// NEWEST tasks: once the tasks table passes 1000 rows, today's picklists stop
// appearing in the Supervisor queue, the Repository and every report at once.
//
// Supabase's query builder is both chainable and thenable: each filter/sort
// method returns the builder, and awaiting the builder OR awaiting .range()
// runs the query. This stub mimics both, so the same test drives the current
// un-paged code (which awaits the builder and therefore only ever sees page
// one) and the fixed paging code.
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

describe("fetchAllTasks — pages past PostgREST's 1000-row default", () => {
  beforeEach(() => {
    pages = [];
    rangeCalls.length = 0;
  });

  it("returns every task, including the newest ones past row 1000", async () => {
    const { fetchAllTasks } = await import("../../src/lib/tasksSupabase");

    // 1000 older tasks, then the 1001st — the most recently created one,
    // because the query orders created_at ascending.
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      data: { no: `B2BE-BLINKIT-260101-${String(i).padStart(3, "0")}`, channel: "Blinkit", facilities: [] },
    }));
    const secondPage = [
      {
        created_at: "2026-09-17T09:00:00.000Z",
        data: { no: "B2BE-BLINKIT-260917-001", channel: "Blinkit", facilities: [] },
      },
    ];
    pages = [{ data: firstPage }, { data: secondPage }];

    const tasks = await fetchAllTasks();

    expect(tasks).toHaveLength(1001);
    expect(tasks.map((t) => t.no)).toContain("B2BE-BLINKIT-260917-001");
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("stops after a short page instead of looping forever", async () => {
    const { fetchAllTasks } = await import("../../src/lib/tasksSupabase");
    pages = [{ data: [{ created_at: "2026-09-17T09:00:00.000Z", data: { no: "ONLY-ONE", channel: "Blinkit", facilities: [] } }] }];

    const tasks = await fetchAllTasks();

    expect(tasks.map((t) => t.no)).toEqual(["ONLY-ONE"]);
    expect(rangeCalls).toEqual([[0, 999]]);
  });
});
