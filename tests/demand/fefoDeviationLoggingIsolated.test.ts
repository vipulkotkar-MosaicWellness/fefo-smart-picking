// tests/demand/fefoDeviationLoggingIsolated.test.ts
// Regression coverage added 2026-09-19 after a live-production investigation:
// the fefo_deviations table had logged zero rows since case-based picking
// went live, which looked suspicious. A live test order on a real
// case-configured SKU (MWBWSKP.00206.B0_N) appeared to skip an entire
// earlier-expiry lot — until it turned out 720 of those 751 units were on an
// unrelated active stock hold, which both allocations correctly excluded
// alike. This file pins that exact shape down as a regression test: a stock
// hold must not be mistaken for a FEFO deviation.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

const logFefoDeviations = vi.fn(async () => undefined);
vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return { ...actual, logFefoDeviations };
});

vi.mock("../../src/lib/tasksSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/tasksSupabase")>();
  return {
    ...actual,
    nextSequence: vi.fn(async () => 1),
    insertTask: vi.fn(async () => undefined),
    fetchAllTasks: vi.fn(async () => []),
    fetchTaskByNo: vi.fn(async () => null),
    updateTaskData: vi.fn(async () => undefined),
    subscribeTasks: vi.fn(() => () => {}),
  };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — FEFO deviation logging, fully isolated from real Supabase network calls", () => {
  afterEach(() => {
    logFefoDeviations.mockClear();
    vi.resetModules();
  });

  it("does NOT log a deviation when the only earlier-expiry lot is fully on an active stock hold (matches the live MWBWSKP.00206.B0_N scenario)", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initial = useStore.getState();

    const stock: StockRow[] = [
      // Earliest expiry, 720 units — but fully held (see heldKeys below), so
      // it must be excluded from BOTH the case-based and strict-FEFO passes
      // identically. No deviation should come from this lot.
      { rid: 1, location: "SL Mother Hub", bin: "R7-C16-003", sku: "SKU-HELD", name: "Product", batch: "OLD-LOT", exp: [2030, 2], qty: 720, shelf: 24, type: "Good", active: "Active" },
      // Later expiry, case-packed, 6484 units — where case-first actually drew from live.
      { rid: 3, location: "SL Mother Hub", bin: "R9-C18-007", sku: "SKU-HELD", name: "Product", batch: "NEW-LOT", exp: [2030, 5], qty: 6484, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({
      stock,
      skus: { "SKU-HELD": { name: "Product", shelf: 24 } },
      caseSizes: { "SKU-HELD": 300 },
      channelRules: { [CHANNEL]: { type: "fixed", val: 0 } },
      tasks: [],
      holds: [{ id: 1, sku: "SKU-HELD", facility: "SL Mother Hub", bin: "R7-C16-003", batch: "OLD-LOT", heldAt: "2026-09-14T00:00:00Z", heldBy: "Tester", qty: 720 }],
    });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-HELD", qty: 350, gatePassNo: "GPSLMH-DEV-3" }]);

    await useStore.getState().generate(null, "Tester");

    // Both allocations see the same held lot excluded, so both land on the
    // later-expiry lot identically — zero deviation is the CORRECT result here.
    expect(logFefoDeviations).not.toHaveBeenCalled();

    useStore.setState(initial, true);
  });
});
