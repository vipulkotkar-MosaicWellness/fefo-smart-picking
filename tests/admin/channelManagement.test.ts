import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../../src/lib/store";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

describe("deleteChannel", () => {
  it("removes the channel from channelRules and channelBuckets", () => {
    useStore.getState().addChannel("Test Channel", "Replenishment", { type: "fixed", val: 6 });
    expect(useStore.getState().channelRules["Test Channel"]).toBeDefined();

    useStore.getState().deleteChannel("Test Channel");
    expect(useStore.getState().channelRules["Test Channel"]).toBeUndefined();
    expect(useStore.getState().channelBuckets["Test Channel"]).toBeUndefined();
  });

  it("records the name in deletedChannels so it won't reappear from code defaults", () => {
    useStore.getState().deleteChannel("Amazon");
    expect(useStore.getState().deletedChannels).toContain("Amazon");
    expect(useStore.getState().channelRules["Amazon"]).toBeUndefined();
  });

  it("does not duplicate an already-deleted name if deleted twice", () => {
    useStore.getState().deleteChannel("Amazon");
    useStore.getState().deleteChannel("Amazon");
    expect(useStore.getState().deletedChannels.filter((c) => c === "Amazon")).toHaveLength(1);
  });

  it("re-adding a deleted channel un-deletes it", () => {
    useStore.getState().deleteChannel("Amazon");
    expect(useStore.getState().deletedChannels).toContain("Amazon");

    useStore.getState().addChannel("Amazon", "B2B Ecom", { type: "fixed", val: 6 });
    expect(useStore.getState().deletedChannels).not.toContain("Amazon");
    expect(useStore.getState().channelRules["Amazon"]).toBeDefined();
  });
});
