import { describe, expect, it } from "vitest";
import { syncSourceLabel } from "../../src/lib/syncSource";

describe("syncSourceLabel", () => {
  it("labels an email sync clearly, with no by-line", () => {
    expect(syncSourceLabel("email", null)).toEqual({ text: "Synced from email", tone: "info" });
  });

  it("labels a manual upload clearly, naming who did it", () => {
    expect(syncSourceLabel("manual", "Vipul Kotkar")).toEqual({ text: "Manually uploaded by Vipul Kotkar", tone: "warn" });
  });

  it("labels a manual upload without a name as a fallback", () => {
    expect(syncSourceLabel("manual", null)).toEqual({ text: "Manually uploaded", tone: "warn" });
  });

  it("falls back to a generic label when the source is unknown (e.g. local demo mode, or data from before this field existed)", () => {
    expect(syncSourceLabel(null, null)).toEqual({ text: "Synced", tone: "muted" });
  });
});
