// tests/lib/fefoDeviationsSupabase.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}));

describe("logFefoDeviations", () => {
  // The mocked supabase client (and its `from` vi.fn()) lives at module
  // scope and is shared across every `it` below via the cached dynamic
  // import — clear its call history before each test so one test's calls
  // to supabase.from don't leak into the next test's assertions (e.g. the
  // "does nothing when empty" test below, which asserts zero calls). Same
  // pattern as tests/lib/caseSizeGaps.test.ts.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts one row per deviation line, carrying facility and gate pass number", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const insert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table !== "fefo_deviations") throw new Error(`unexpected table ${table}`);
      return { insert } as never;
    });

    await logFefoDeviations("SL Mother Hub", "GPSLMH12345", [
      { sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviationQty: 10 },
    ]);

    expect(insert).toHaveBeenCalledWith([
      { gate_pass_no: "GPSLMH12345", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "CASE-LOT", deviation_qty: 10 },
    ]);
  });

  it("stores a null gate pass number when the facility is still Gate Pass Allocation Pending", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const insert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ insert }) as never);

    await logFefoDeviations("SL Mother Hub", undefined, [{ sku: "SKU-X", bin: "A1", batch: "B1", deviationQty: 5 }]);

    expect(insert).toHaveBeenCalledWith([
      { gate_pass_no: null, facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 5 },
    ]);
  });

  it("does nothing when there are no deviation lines", async () => {
    const { logFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    await logFefoDeviations("SL Mother Hub", "GPSLMH12345", []);
    expect(supabase!.from).not.toHaveBeenCalled();
  });
});

describe("fetchFefoDeviations", () => {
  it("selects rows created on or after the given date", async () => {
    const { fetchFefoDeviations } = await import("../../src/lib/fefoDeviationsSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const gte = vi.fn(async () => ({ data: [{ gate_pass_no: "GPSLMH1", facility: "SL Mother Hub", sku: "SKU-X", bin: "A1", batch: "B1", deviation_qty: 10, created_at: "2026-09-17T00:00:00.000Z" }], error: null }));
    const select = vi.fn(() => ({ gte }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ select }) as never);

    const rows = await fetchFefoDeviations("2026-09-17");

    expect(select).toHaveBeenCalledWith("gate_pass_no,facility,sku,bin,batch,deviation_qty,created_at");
    expect(gte).toHaveBeenCalledWith("created_at", "2026-09-17");
    expect(rows).toHaveLength(1);
  });
});
