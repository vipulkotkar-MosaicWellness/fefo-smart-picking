import { describe, expect, it } from "vitest";
import { formatAge } from "../../src/lib/ageing";

describe("formatAge", () => {
  it("shows minutes under an hour", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(formatAge("2026-09-14T11:35:00Z", now)).toBe("25m");
  });

  it("shows whole hours under a day", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(formatAge("2026-09-14T00:00:00Z", now)).toBe("12h");
  });

  it("shows days and hours at a day or more", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(formatAge("2026-09-10T08:00:00Z", now)).toBe("4d 4h");
  });

  it("never goes negative for a clock-skewed future timestamp", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(formatAge("2026-09-14T13:00:00Z", now)).toBe("0m");
  });
});
