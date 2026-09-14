import { describe, expect, it } from "vitest";
import { familyFor, groupPicklistFamilies } from "../../src/lib/picklistFamilies";
import type { FacilityPicklist, PickingTask } from "../../src/lib/types";

function line(overrides: Partial<FacilityPicklist["lines"][number]> = {}) {
  return { rid: 1, sku: "SKU-1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1] as [number, number], rem: 12, qty: 10, ...overrides };
}

function facility(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "TASK-1-MH",
    taskNo: "TASK-1",
    facility: "SL Mother Hub",
    status: "open",
    round: 1,
    bad: 0,
    lines: [line()],
    createdAt: "2026-08-04T10:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<PickingTask> = {}): PickingTask {
  return {
    no: "TASK-1",
    gatePassNo: "GP-1001",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-08-04T10:00:00.000Z",
    facilities: [],
    ...overrides,
  };
}

describe("groupPicklistFamilies", () => {
  it("puts a picklist with no re-offer into its own single-round family", () => {
    const t = task({ facilities: [facility()] });
    const [fam] = groupPicklistFamilies([t]);
    expect(fam.rounds).toHaveLength(1);
    expect(fam.rounds[0].round).toBe(1);
  });

  it("groups the original and its not-found re-offer into one family, sorted by round", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1, status: "completed", bad: 3, createdAt: "2026-08-03T10:00:00.000Z" }),
        facility({ no: "TASK-1-MH-R2", round: 2, status: "open", createdAt: "2026-08-04T09:00:00.000Z" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
    expect(families[0].rounds.map((r) => r.round)).toEqual([1, 2]);
  });

  it("reports the latest activity time across all rounds, not just the original", () => {
    const t = task({
      createdAt: "2026-08-01T00:00:00.000Z",
      facilities: [
        facility({ no: "TASK-1-MH", round: 1, createdAt: "2026-08-03T10:00:00.000Z" }),
        facility({ no: "TASK-1-MH-R2", round: 2, createdAt: "2026-08-04T09:00:00.000Z" }),
      ],
    });
    const [fam] = groupPicklistFamilies([t]);
    expect(fam.latestCreatedAt).toBe("2026-08-04T09:00:00.000Z");
  });

  it("falls back to the parent task's createdAt when a round has no createdAt of its own", () => {
    const t = task({
      createdAt: "2026-08-02T00:00:00.000Z",
      facilities: [facility({ no: "TASK-1-MH", round: 1, createdAt: undefined })],
    });
    const [fam] = groupPicklistFamilies([t]);
    expect(fam.latestCreatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("keeps two different facilities of the same task as two separate families", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", facility: "SL Mother Hub" }),
        facility({ no: "TASK-1-AMB", facility: "SL Ambient" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(2);
  });

  it("links a re-offer to its original via reofferedFrom even when it landed on a different facility", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", facility: "SL Mother Hub", round: 1, status: "completed", bad: 5 }),
        facility({ no: "TASK-1-AMB-R2", facility: "SL Ambient", round: 2, reofferedFrom: "TASK-1-MH" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
    expect(families[0].rounds.map((r) => r.no)).toEqual(["TASK-1-MH", "TASK-1-AMB-R2"]);
  });

  it("walks a multi-hop reofferedFrom chain back to the original", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-AMB-R2", facility: "SL Ambient", round: 2, reofferedFrom: "TASK-1-MH" }),
        facility({ no: "TASK-1-RX-R3", facility: "SL RX", round: 3, reofferedFrom: "TASK-1-AMB-R2" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
    expect(families[0].rounds.map((r) => r.no)).toEqual(["TASK-1-MH", "TASK-1-AMB-R2", "TASK-1-RX-R3"]);
  });

  it("falls back to the same-facility-suffix guess when reofferedFrom is absent (historical data)", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-MH-R2", round: 2 }), // no reofferedFrom — pre-existing data shape
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families).toHaveLength(1);
  });

  it("does not hang on a reofferedFrom cycle (malformed/corrupted data)", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-A", round: 2, reofferedFrom: "TASK-1-B" }),
        facility({ no: "TASK-1-B", round: 2, reofferedFrom: "TASK-1-A" }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    expect(families.length).toBeGreaterThan(0);
  });
});

describe("familyFor", () => {
  it("finds the family containing a given facility picklist", () => {
    const t = task({
      facilities: [
        facility({ no: "TASK-1-MH", round: 1 }),
        facility({ no: "TASK-1-MH-R2", round: 2 }),
      ],
    });
    const families = groupPicklistFamilies([t]);
    const target = t.facilities[1];
    expect(familyFor(target, families)?.rounds).toHaveLength(2);
  });

  it("returns undefined when the facility isn't in any given family", () => {
    expect(familyFor(facility({ no: "GHOST" }), [])).toBeUndefined();
  });
});
