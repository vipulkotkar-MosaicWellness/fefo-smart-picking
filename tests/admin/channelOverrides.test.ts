import { describe, expect, it } from "vitest";
import { applyChannelOverrides, type ChannelOverrideRow } from "../../src/lib/channelsSupabase";
import { CHANNELS } from "../../src/lib/channels";

describe("applyChannelOverrides", () => {
  it("keeps every built-in channel untouched when there are no overrides", () => {
    const { channelRules, channelBuckets, deletedChannels } = applyChannelOverrides([]);
    expect(channelRules).toEqual(CHANNELS);
    expect(channelBuckets).toEqual({});
    expect(deletedChannels).toEqual([]);
  });

  it("applies a rule edit to an existing built-in channel without touching its bucket", () => {
    const overrides: ChannelOverrideRow[] = [
      { name: "Amazon", bucket: null, rule_type: "fixed", rule_val: 9, min_bin_qty: null, deleted: false },
    ];
    const { channelRules } = applyChannelOverrides(overrides);
    expect(channelRules.Amazon).toEqual({ type: "fixed", val: 9, minBinQty: undefined });
    // every other built-in channel is unaffected
    expect(channelRules.Myntra).toEqual(CHANNELS.Myntra);
  });

  it("adds a brand-new custom channel with its own bucket", () => {
    const overrides: ChannelOverrideRow[] = [
      { name: "LJ Kolkata", bucket: "Replenishment", rule_type: "pct", rule_val: 0.2, min_bin_qty: 20, deleted: false },
    ];
    const { channelRules, channelBuckets } = applyChannelOverrides(overrides);
    expect(channelRules["LJ Kolkata"]).toEqual({ type: "pct", val: 0.2, minBinQty: 20 });
    expect(channelBuckets["LJ Kolkata"]).toBe("Replenishment");
  });

  it("removes a deleted built-in channel from both rules and buckets, and records it", () => {
    const overrides: ChannelOverrideRow[] = [
      { name: "Amazon", bucket: null, rule_type: "fixed", rule_val: 6, min_bin_qty: null, deleted: true },
    ];
    const { channelRules, channelBuckets, deletedChannels } = applyChannelOverrides(overrides);
    expect(channelRules.Amazon).toBeUndefined();
    expect(channelBuckets.Amazon).toBeUndefined();
    expect(deletedChannels).toContain("Amazon");
  });

  it("a deleted custom channel never appears at all, since it was never a built-in default", () => {
    const overrides: ChannelOverrideRow[] = [
      { name: "Some Custom Channel", bucket: "B2B Offline", rule_type: "fixed", rule_val: 6, min_bin_qty: null, deleted: true },
    ];
    const { channelRules, channelBuckets, deletedChannels } = applyChannelOverrides(overrides);
    expect(channelRules["Some Custom Channel"]).toBeUndefined();
    expect(channelBuckets["Some Custom Channel"]).toBeUndefined();
    expect(deletedChannels).toContain("Some Custom Channel");
  });
});
