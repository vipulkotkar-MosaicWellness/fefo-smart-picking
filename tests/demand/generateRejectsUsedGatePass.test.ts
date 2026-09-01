import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickingTask, StockRow } from "../../src/lib/types";

// generate() now re-fetches tasks fresh from Supabase right before
// allocating (see the cross-user race comment in store.ts), instead of
// trusting whatever's already in local state — so these tests mock
// fetchAllTasks to hand back the fixture data, the same way real Supabase
// would if that fixture task actually existed there.
let mockTasks: PickingTask[] = [];
vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return { ...actual, fetchAllTasks: vi.fn(async () => mockTasks), insertTask: vi.fn(async () => undefined) };
});

// Real cases: GPSLAMB27789 and GPSLMH9820 — a demand CSV's "Gate Pass
// Number" column pre-filled with a number that was already claimed by a
// completely unrelated, earlier order. generate() applied it anyway,
// so the new order silently attached to a gate pass someone else's order
// already owned, and the person looking for their new order found the OLD
// one instead and couldn't find any trace of what they'd just uploaded.
function existingTaskWithGatePass(): PickingTask {
  return {
    no: "TASK-EXISTING",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      { no: "TASK-EXISTING-MH", taskNo: "TASK-EXISTING", facility: "SL Mother Hub", status: "open", round: 1, bad: 0, gatePassNo: "GPSLMH9820", lines: [] },
    ],
  };
}

describe("generate() — CSV-supplied gate pass already claimed elsewhere", () => {
  afterEach(() => { mockTasks = []; });

  it("does not attach the duplicate gate pass to the new order; it falls through to pending instead", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 501, location: "SL Mother Hub", bin: "A1", sku: "SKU-DUPE-GP", name: "Product", batch: "B1", exp: [2099, 1], qty: 100, shelf: 24, type: "Good", active: "Active" },
    ];
    mockTasks = [existingTaskWithGatePass()];
    useStore.setState({ stock, skus: { "SKU-DUPE-GP": { name: "Product", shelf: 24 } }, tasks: mockTasks });
    useStore.getState().setDemand([{ channel: "Blinkit", sku: "SKU-DUPE-GP", qty: 50, gatePassNo: "GPSLMH9820" }]);

    await useStore.getState().generate(null, "Tester");

    const newTask = useStore.getState().tasks.find((t) => t.no !== "TASK-EXISTING")!;
    expect(newTask).toBeDefined();
    const facility = newTask.facilities[0];
    // The duplicate was rejected, not applied — falls through to pending exactly like no gate pass was given.
    expect(facility.gatePassNo).toBeUndefined();
    // The original order's gate pass is completely untouched.
    expect(useStore.getState().tasks.find((t) => t.no === "TASK-EXISTING")!.facilities[0].gatePassNo).toBe("GPSLMH9820");
    // The notice explains what happened and where the number is really from.
    expect(useStore.getState().notice).toMatch(/already in use elsewhere/);
    expect(useStore.getState().notice).toMatch(/TASK-EXISTING/);

    useStore.setState(initialState, true);
  });

  it("still applies a gate pass number that genuinely isn't in use anywhere", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 502, location: "SL Mother Hub", bin: "A2", sku: "SKU-FRESH-GP", name: "Product 2", batch: "B2", exp: [2099, 1], qty: 100, shelf: 24, type: "Good", active: "Active" },
    ];
    mockTasks = [];
    useStore.setState({ stock, skus: { "SKU-FRESH-GP": { name: "Product 2", shelf: 24 } }, tasks: [] });
    useStore.getState().setDemand([{ channel: "Blinkit", sku: "SKU-FRESH-GP", qty: 50, gatePassNo: "GPSLMH-FRESH" }]);

    await useStore.getState().generate(null, "Tester");

    const newTask = useStore.getState().tasks[0];
    expect(newTask.facilities[0].gatePassNo).toBe("GPSLMH-FRESH");
    expect(useStore.getState().notice).not.toMatch(/already in use elsewhere/);

    useStore.setState(initialState, true);
  });
});
