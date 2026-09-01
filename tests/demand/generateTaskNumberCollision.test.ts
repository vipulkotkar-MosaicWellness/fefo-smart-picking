import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

// Real case: one demand upload with "Internal Stock Transfer - Warehouse -
// Local" and "Internal Stock Transfer - Dark Stores" — both reduce to the
// same 12-char task-number prefix (channelCode() truncates at 12 chars, and
// both channel names are identical for their first 12 alphanumeric
// characters: "INTERNALSTOC"). generate() asked nextSequence() for each
// channel's number BEFORE inserting either into Supabase, so both got the
// same answer and tried to claim the identical task number — the second
// insert failed outright with "duplicate key... tasks_pkey" and that
// channel's picklist was never saved at all.
vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return {
    ...actual,
    nextSequence: vi.fn(async () => 7), // same "7 already exist" answer every time, matching real Supabase behavior mid-batch
    insertTask: vi.fn(async () => undefined),
  };
});

const CHANNEL_A = "Internal Stock Transfer - Warehouse - Local";
const CHANNEL_B = "Internal Stock Transfer - Dark Stores";

describe("generate() — task numbers stay unique within one multi-channel batch", () => {
  afterEach(() => vi.resetModules());

  it("gives two channels sharing a task-number prefix distinct numbers, not a collision", async () => {
    const tasksSupabase = await import("../../src/lib/tasksSupabase");
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-COLLIDE", name: "Product", batch: "B1", exp: [2099, 1], qty: 100, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-COLLIDE": { name: "Product", shelf: 24 } }, tasks: [] });
    useStore.getState().setDemand([
      { channel: CHANNEL_A, sku: "SKU-COLLIDE", qty: 10 },
      { channel: CHANNEL_B, sku: "SKU-COLLIDE", qty: 10 },
    ]);

    await useStore.getState().generate(null, "Tester");

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const nos = tasks.map((t) => t.no);
    expect(new Set(nos).size).toBe(2); // no collision

    // Both prefixes are in fact identical — proves this test is exercising the real bug, not a strawman.
    const prefixes = nos.map((no) => no.replace(/\d{3}$/, ""));
    expect(prefixes[0]).toBe(prefixes[1]);

    // Both channels' work actually got saved — no silent drop from a rejected duplicate-key insert.
    expect(vi.mocked(tasksSupabase.insertTask)).toHaveBeenCalledTimes(2);
    const insertedNos = vi.mocked(tasksSupabase.insertTask).mock.calls.map((c) => (c[0] as { no: string }).no);
    expect(new Set(insertedNos).size).toBe(2);

    useStore.setState(initialState, true);
  });
});
