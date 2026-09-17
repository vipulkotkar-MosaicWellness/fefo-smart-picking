// tests/demand/fefoDeviationLogging.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

const logFefoDeviations = vi.fn(async () => undefined);
vi.mock("../../src/lib/fefoDeviationsSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/fefoDeviationsSupabase")>();
  return { ...actual, logFefoDeviations };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — logs FEFO deviation for a real order on a case-configured SKU", () => {
  afterEach(() => {
    logFefoDeviations.mockClear();
    vi.resetModules();
  });

  it("logs a deviation when case-first takes more from a lot than strict FEFO would have", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initial = useStore.getState();

    // 20 units at earliest expiry (loose, no case), 500 at a later expiry
    // (case-packed lot). Need 100, case size 30: case-first takes 3 cases
    // (90) from the later lot + 10 eaches from the earliest bin — a
    // 10-unit deviation on the later lot, exactly the design doc's example.
    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A5", sku: "SKU-DEV", name: "Product", batch: "EACHES-LOT", exp: [2027, 1], qty: 20, shelf: 24, type: "Good", active: "Active" },
      { rid: 2, location: "SL Mother Hub", bin: "A1", sku: "SKU-DEV", name: "Product", batch: "CASE-LOT", exp: [2027, 6], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-DEV": { name: "Product", shelf: 24 } }, caseSizes: { "SKU-DEV": 30 }, tasks: [] });
    // Gate pass prefix must match "SL Mother Hub" (GPSLMH — see
    // FACILITY_GATE_PASS_PREFIX in facilities.ts) so reconcileGatePasses()
    // actually resolves it onto this facility instead of leaving it pending.
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-DEV", qty: 100, gatePassNo: "GPSLMH-DEV-1" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logFefoDeviations).toHaveBeenCalledWith(
      "SL Mother Hub",
      "GPSLMH-DEV-1",
      [{ sku: "SKU-DEV", bin: "A1", batch: "CASE-LOT", deviationQty: 10 }],
    );

    useStore.setState(initial, true);
  });

  it("does NOT compute or log anything when no SKU in the demand has a case size configured", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initial = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-PLAIN", name: "Product", batch: "B1", exp: [2027, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-PLAIN": { name: "Product", shelf: 24 } }, caseSizes: {}, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-PLAIN", qty: 50, gatePassNo: "GPSLMH-DEV-2" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logFefoDeviations).not.toHaveBeenCalled();

    useStore.setState(initial, true);
  });
});
