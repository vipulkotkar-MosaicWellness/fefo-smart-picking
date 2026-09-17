// tests/lib/caseSizeGaps.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(),
  },
}));

describe("logCaseSizeGaps", () => {
  // The mocked supabase client (and its `from` vi.fn()) lives at module
  // scope and is shared across every `it` below via the cached dynamic
  // import — clear its call history before each test so one test's calls
  // to supabase.from don't leak into the next test's assertions (e.g. the
  // "does nothing when empty" test below, which asserts zero calls).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new row for a SKU seen for the first time", async () => {
    const { logCaseSizeGaps } = await import("../../src/lib/caseSizesSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const selectChain = { in: vi.fn(async () => ({ data: [], error: null })) };
    const upsert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table !== "case_size_gaps") throw new Error(`unexpected table ${table}`);
      return { select: vi.fn(() => selectChain), upsert } as never;
    });

    await logCaseSizeGaps([{ sku: "SKU-NOCASE", qty: 50 }]);

    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ sku: "SKU-NOCASE", occurrences: 1, total_qty: 50 })],
      { onConflict: "sku" },
    );
  });

  it("merges multiple demand lines for the same SKU in one call into a single row", async () => {
    const { logCaseSizeGaps } = await import("../../src/lib/caseSizesSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const selectChain = { in: vi.fn(async () => ({ data: [], error: null })) };
    const upsert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ select: vi.fn(() => selectChain), upsert }) as never);

    await logCaseSizeGaps([
      { sku: "SKU-MULTI", qty: 20 },
      { sku: "SKU-MULTI", qty: 15 },
    ]);

    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ sku: "SKU-MULTI", occurrences: 2, total_qty: 35 })],
      { onConflict: "sku" },
    );
  });

  it("accumulates onto an existing row instead of overwriting it", async () => {
    const { logCaseSizeGaps } = await import("../../src/lib/caseSizesSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    const selectChain = {
      in: vi.fn(async () => ({
        data: [{ sku: "SKU-SEEN-BEFORE", first_seen_at: "2026-09-01T00:00:00.000Z", occurrences: 3, total_qty: 100 }],
        error: null,
      })),
    };
    const upsert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase!.from).mockImplementation(() => ({ select: vi.fn(() => selectChain), upsert }) as never);

    await logCaseSizeGaps([{ sku: "SKU-SEEN-BEFORE", qty: 25 }]);

    const [[rows]] = upsert.mock.calls;
    expect(rows[0].first_seen_at).toBe("2026-09-01T00:00:00.000Z"); // preserved, not reset
    expect(rows[0].occurrences).toBe(4); // 3 + 1
    expect(rows[0].total_qty).toBe(125); // 100 + 25
  });

  it("does nothing when the list is empty", async () => {
    const { logCaseSizeGaps } = await import("../../src/lib/caseSizesSupabase");
    const { supabase } = await import("../../src/lib/supabaseClient");
    await logCaseSizeGaps([]);
    expect(supabase!.from).not.toHaveBeenCalled();
  });
});
