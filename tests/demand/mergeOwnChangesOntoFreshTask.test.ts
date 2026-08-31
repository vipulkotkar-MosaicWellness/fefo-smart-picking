import { describe, expect, it } from "vitest";
import { mergeOwnChangesOntoFreshTask } from "../../src/lib/store";
import type { FacilityPicklist, PickingTask } from "../../src/lib/types";

const CHANNEL = "Internal Stock Transfer - Warehouse - Local";

function facility(over: Partial<FacilityPicklist> & Pick<FacilityPicklist, "no" | "facility" | "status" | "round">): FacilityPicklist {
  return {
    taskNo: "TASK-MERGE",
    bad: 0,
    lines: [],
    ...over,
  };
}

function task(facilities: FacilityPicklist[]): PickingTask {
  return { no: "TASK-MERGE", channel: CHANNEL, demand: [], facilities, shortfall: [], createdAt: new Date().toISOString() };
}

describe("mergeOwnChangesOntoFreshTask", () => {
  it("keeps a sibling facility's concurrent completion instead of overwriting it with this device's stale copy", () => {
    // `local` was read before someone else completed AMB — its AMB is still "open".
    const local = task([
      facility({ no: "TASK-MERGE-MH", facility: "SL Mother Hub", status: "completed", round: 1, pickedTotal: 10 }),
      facility({ no: "TASK-MERGE-AMB", facility: "SL Ambient", status: "open", round: 1 }),
    ]);
    // `fresh` is what's actually in the database right now — someone else
    // completed AMB in the meantime, this device doesn't know that yet.
    const fresh = task([
      facility({ no: "TASK-MERGE-MH", facility: "SL Mother Hub", status: "completed", round: 1, pickedTotal: 10 }),
      facility({ no: "TASK-MERGE-AMB", facility: "SL Ambient", status: "completed", round: 1, pickedTotal: 7 }),
    ]);

    // This device only just finished MH — it owns MH, not AMB.
    const result = mergeOwnChangesOntoFreshTask(fresh, local, new Set(["TASK-MERGE-MH"]));

    const amb = result.facilities.find((f) => f.no === "TASK-MERGE-AMB");
    expect(amb?.status).toBe("completed"); // preserved from fresh, NOT clobbered back to "open"
    expect(amb?.pickedTotal).toBe(7);
    const mh = result.facilities.find((f) => f.no === "TASK-MERGE-MH");
    expect(mh?.pickedTotal).toBe(10); // this device's own change is applied
  });

  it("appends a brand-new round-2 facility that fresh doesn't have yet", () => {
    const local = task([
      facility({ no: "TASK-MERGE-MH", facility: "SL Mother Hub", status: "completed", round: 1 }),
      facility({ no: "TASK-MERGE-MH-R2", facility: "SL Mother Hub", status: "open", round: 2 }),
    ]);
    const fresh = task([facility({ no: "TASK-MERGE-MH", facility: "SL Mother Hub", status: "completed", round: 1 })]);

    const result = mergeOwnChangesOntoFreshTask(fresh, local, new Set(["TASK-MERGE-MH", "TASK-MERGE-MH-R2"]));

    expect(result.facilities.some((f) => f.no === "TASK-MERGE-MH-R2")).toBe(true);
    expect(result.facilities).toHaveLength(2);
  });

  it("never touches a facility this operation doesn't own, even if local has a different (older) copy of it", () => {
    const local = task([facility({ no: "TASK-MERGE-AMB", facility: "SL Ambient", status: "open", round: 1, bad: 0 })]);
    const fresh = task([facility({ no: "TASK-MERGE-AMB", facility: "SL Ambient", status: "completed", round: 1, bad: 3 })]);

    // ownFacilityNos is empty — this operation didn't touch AMB at all.
    const result = mergeOwnChangesOntoFreshTask(fresh, local, new Set());

    expect(result.facilities[0]).toEqual(fresh.facilities[0]);
  });
});
