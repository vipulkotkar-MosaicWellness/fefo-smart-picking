import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return {
    ...actual,
    // generate() refetches tasks before allocating — empty, so nothing that
    // really exists in Supabase interferes with this fixture.
    fetchAllTasks: vi.fn(async () => []),
    nextSequence: vi.fn(async () => 1),
    insertTask: vi.fn(async () => undefined),
  };
});

// Sibling of the already-fixed task-number collision (see
// generateTaskNumberCollision.test.ts and seqUsedThisBatch in store.ts).
// findGatePassConflict only looks at the freshly-refetched `tasks`, and
// nothing is inserted until AFTER the whole allocation loop — so a gate pass
// number typed onto two rows of one demand CSV under two DIFFERENT channels
// (separate gatePassGroupKey groups, therefore separate tasks) passed the
// duplicate check twice and got applied to both. The same real failure mode as
// GPSLAMB27789 / GPSLMH9820, just inside a single upload instead of across two:
// whoever searches that gate pass finds two unrelated orders claiming it.
const GATE_PASS = "GPSLMH9820"; // GPSLMH prefix -> reconciles to SL Mother Hub

describe("generate() — one gate pass number cannot be claimed twice in the same batch", () => {
  afterEach(() => vi.resetModules());

  it("applies it to the first channel and rejects it for the second", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-DUP-GP", name: "Product", batch: "BA019232", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-DUP-GP": { name: "Product", shelf: 24 } },
      channelRules: { Blinkit: { type: "pct", val: 0.75 }, Zepto: { type: "pct", val: 0.75 } },
      tasks: [],
    });
    useStore.getState().setDemand([
      { channel: "Blinkit", sku: "SKU-DUP-GP", qty: 10, gatePassNo: GATE_PASS },
      { channel: "Zepto", sku: "SKU-DUP-GP", qty: 10, gatePassNo: GATE_PASS },
    ]);

    await useStore.getState().generate(null, "Tester");

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2);

    const blinkit = tasks.find((t) => t.channel === "Blinkit")!;
    const zepto = tasks.find((t) => t.channel === "Zepto")!;

    // Exactly one of the two ends up holding the number — never both.
    const holders = tasks.flatMap((t) => t.facilities).filter((f) => f.gatePassNo === GATE_PASS);
    expect(holders).toHaveLength(1);

    // First group in demand order keeps it; the second falls through to
    // pending, exactly as if no gate pass had been supplied for it.
    expect(blinkit.facilities[0].gatePassNo).toBe(GATE_PASS);
    expect(zepto.facilities[0].gatePassNo).toBeUndefined();

    // And the planner is told, naming the order that already claimed it.
    expect(useStore.getState().notice).toMatch(/already in use elsewhere/);
    expect(useStore.getState().notice).toContain(GATE_PASS);
    expect(useStore.getState().notice).toContain(blinkit.no);
    expect(useStore.getState().notice).toMatch(/awaiting gate pass allocation/);

    useStore.setState(initialState, true);
  });

  it("still lets two channels each keep their own distinct gate pass", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-OK-GP", name: "Product", batch: "BA019232", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-OK-GP": { name: "Product", shelf: 24 } },
      channelRules: { Blinkit: { type: "pct", val: 0.75 }, Zepto: { type: "pct", val: 0.75 } },
      tasks: [],
    });
    useStore.getState().setDemand([
      { channel: "Blinkit", sku: "SKU-OK-GP", qty: 10, gatePassNo: "GPSLMH10001" },
      { channel: "Zepto", sku: "SKU-OK-GP", qty: 10, gatePassNo: "GPSLMH10002" },
    ]);

    await useStore.getState().generate(null, "Tester");

    const tasks = useStore.getState().tasks;
    expect(tasks.find((t) => t.channel === "Blinkit")!.facilities[0].gatePassNo).toBe("GPSLMH10001");
    expect(tasks.find((t) => t.channel === "Zepto")!.facilities[0].gatePassNo).toBe("GPSLMH10002");
    expect(useStore.getState().notice).not.toMatch(/already in use elsewhere/);

    useStore.setState(initialState, true);
  });
});
