import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Handler {
  event: string;
  config: { event: string; schema: string; table: string };
  cb: () => void;
}
const channelNames: string[] = [];
const handlers: Handler[] = [];
const removed: unknown[] = [];
let holdRows: unknown[] = [];

function fakeChannel(name: string) {
  channelNames.push(name);
  const ch: Record<string, unknown> = { name };
  ch.on = vi.fn((event: string, config: Handler["config"], cb: () => void) => {
    handlers.push({ event, config, cb });
    return ch;
  });
  ch.subscribe = vi.fn(() => ch);
  return ch;
}

function queryBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "order", "eq", "gte"]) chain[m] = vi.fn(self);
  let served = false;
  chain.range = vi.fn(() => {
    const data = served ? [] : holdRows;
    served = true;
    return Promise.resolve({ data, error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: holdRows, error: null }).then(resolve);
  return chain;
}

vi.mock("../../src/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => queryBuilder()),
    channel: vi.fn((name: string) => fakeChannel(name)),
    removeChannel: vi.fn((ch: unknown) => removed.push(ch)),
  },
}));

function holdRow(id: number, releasedAt: string | null = null) {
  return {
    id,
    sku: "SKU-HELD",
    facility: "SL Mother Hub",
    bin: "R7-C19-002",
    batch: "BA036161",
    qty: 40,
    held_at: "2026-09-16T10:00:00.000Z",
    held_by: "Supervisor A",
    reason: "Batch mismatch",
    source_task_no: "B2BE-BLINKIT-260916-001",
    released_at: releasedAt,
    released_by: releasedAt ? "Supervisor A" : null,
  };
}

beforeEach(() => {
  channelNames.length = 0;
  handlers.length = 0;
  removed.length = 0;
  holdRows = [];
});
afterEach(() => vi.resetModules());

describe("subscribeHolds", () => {
  it("listens for every change on the stock_holds table", async () => {
    const { subscribeHolds } = await import("../../src/lib/holdsSupabase");
    const onChange = vi.fn();

    subscribeHolds(onChange);

    expect(channelNames).toEqual(["stock-holds-realtime"]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].event).toBe("postgres_changes");
    expect(handlers[0].config).toEqual({ event: "*", schema: "public", table: "stock_holds" });

    handlers[0].cb();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("removes the channel when unsubscribed", async () => {
    const { subscribeHolds } = await import("../../src/lib/holdsSupabase");
    const stop = subscribeHolds(vi.fn());
    stop();
    expect(removed).toHaveLength(1);
  });
});

describe("startHoldsRealtime", () => {
  it("pulls another device's hold into this device's state without a reload", async () => {
    const { useStore } = await import("../../src/lib/store");
    const initialState = useStore.getState();

    // This device starts with no holds at all.
    useStore.setState({ holds: [] });
    const stop = useStore.getState().startHoldsRealtime();

    // Another supervisor places a hold on R7-C19-002 / BA036161.
    holdRows = [holdRow(501)];
    handlers[0].cb();
    await vi.waitFor(() => expect(useStore.getState().holds).toHaveLength(1));

    expect(useStore.getState().holds[0].id).toBe(501);
    expect(useStore.getState().holds[0].bin).toBe("R7-C19-002");

    stop();
    useStore.setState(initialState, true);
  });
});
