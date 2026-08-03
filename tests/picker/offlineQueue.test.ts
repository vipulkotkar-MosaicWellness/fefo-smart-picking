import { beforeEach, describe, expect, it } from "vitest";
import { dequeue, enqueue, loadQueue } from "../../src/lib/offlineQueue";

beforeEach(() => localStorage.clear());

describe("offline pick queue", () => {
  it("starts empty", () => {
    expect(loadQueue()).toEqual([]);
  });

  it("enqueues a pick result and persists it across loads", () => {
    enqueue({ facilityNo: "PK-1-MH", results: { 1: 0, 2: 3 } });
    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].facilityNo).toBe("PK-1-MH");
    expect(queue[0].results).toEqual({ 1: 0, 2: 3 });
  });

  it("removes an item once it's been synced", () => {
    const item = enqueue({ facilityNo: "PK-1-MH", results: { 1: 0 } });
    dequeue(item.id);
    expect(loadQueue()).toEqual([]);
  });
});
