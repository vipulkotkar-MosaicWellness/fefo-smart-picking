import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask, StockRow } from "../../src/lib/types";

// Two different PEOPLE generating picklists around the same time, against
// the same scarce stock — not one person's own multi-channel batch (that's
// generateTaskNumberCollision / the over-allocation fix in
// allocationPreview.test.ts), but a genuinely stale browser tab. Device A's
// local `tasks` was loaded before Device B's order (which already reserved
// most of the only bin) was created. generate() must check the real,
// current picture right before allocating — not whatever's been sitting in
// Device A's memory — so it doesn't promise stock Device B's order already
// has a claim on.
vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchAllTasks: vi.fn(), insertTask: vi.fn(async () => undefined) };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — cross-user race safety", () => {
  afterEach(() => vi.resetModules());

  it("sees another user's just-created reservation instead of the stale local snapshot", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-RACE2", name: "Race product", batch: "B1", exp: [2099, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
    ];

    // Device A's local view: nothing has claimed this bin yet (stale/out of date).
    useStore.setState({ stock, skus: { "SKU-RACE2": { name: "Race product", shelf: 24 } }, tasks: [] });

    // But Device B's order — created moments ago by someone else — already
    // reserved 15 of the 20 units, in the real database Device A hasn't
    // seen yet.
    const othersOrder: PickingTask = {
      no: "TASK-OTHERUSER",
      channel: CHANNEL,
      demand: [],
      shortfall: [],
      createdAt: new Date().toISOString(),
      facilities: [
        {
          no: "TASK-OTHERUSER-MH", taskNo: "TASK-OTHERUSER", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
          lines: [{ rid: 1, sku: "SKU-RACE2", name: "Race product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 15 }],
        },
      ],
    };
    vi.mocked(tasksSupabase.fetchAllTasks).mockResolvedValue([othersOrder]);

    // Device A now tries to generate its own order for 10 units — more than the 5 genuinely left.
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-RACE2", qty: 10 }]);
    await useStore.getState().generate(null, "Tester");

    expect(tasksSupabase.fetchAllTasks).toHaveBeenCalled();

    const newTask = useStore.getState().tasks.find((t) => t.no !== "TASK-OTHERUSER")!;
    expect(newTask).toBeDefined();
    const totalClaimed = newTask.facilities.flatMap((f) => f.lines).reduce((s, l) => s + l.qty, 0);
    // Only the 5 units genuinely left (20 - 15) get claimed, never the full 10 asked for.
    expect(totalClaimed).toBe(5);
    expect(newTask.shortfall).toEqual([{ sku: "SKU-RACE2", name: "Race product", qty: 5 }]);

    // The other user's own reservation is completely untouched.
    const otherTask = useStore.getState().tasks.find((t) => t.no === "TASK-OTHERUSER")!;
    expect(otherTask.facilities[0].lines[0].qty).toBe(15);

    useStore.setState(initialState, true);
  });
});
