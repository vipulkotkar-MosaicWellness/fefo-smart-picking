// tests/demand/caseSizeGapLogging.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockRow } from "../../src/lib/types";

const logCaseSizeGaps = vi.fn(async () => undefined);
vi.mock("../../src/lib/caseSizesSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/caseSizesSupabase")>();
  return { ...actual, logCaseSizeGaps };
});

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

describe("generate() — logs a gap for a real order on a SKU with no case size", () => {
  afterEach(() => {
    logCaseSizeGaps.mockClear();
    vi.resetModules();
  });

  it("logs the SKU and quantity when generate() actually creates a task", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-GAP", name: "Product Gap", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-GAP": { name: "Product Gap", shelf: 24 } }, caseSizes: {}, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-GAP", qty: 75, gatePassNo: "GP-GAP-1" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logCaseSizeGaps).toHaveBeenCalledWith([{ sku: "SKU-GAP", qty: 75 }]);

    useStore.setState(initialState, true);
  });

  it("does NOT log a SKU that has a configured case size", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    const stock: StockRow[] = [
      { rid: 1, location: "SL Mother Hub", bin: "A1", sku: "SKU-COVERED", name: "Product Covered", batch: "B1", exp: [2099, 1], qty: 500, shelf: 24, type: "Good", active: "Active" },
    ];
    useStore.setState({ stock, skus: { "SKU-COVERED": { name: "Product Covered", shelf: 24 } }, caseSizes: { "SKU-COVERED": 30 }, tasks: [] });
    useStore.getState().setDemand([{ channel: CHANNEL, sku: "SKU-COVERED", qty: 75, gatePassNo: "GP-GAP-2" }]);

    await useStore.getState().generate(null, "Tester");

    expect(logCaseSizeGaps).not.toHaveBeenCalled();

    useStore.setState(initialState, true);
  });
});
