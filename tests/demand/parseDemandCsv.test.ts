import { describe, expect, it } from "vitest";
import { parseDemandCsv } from "../../src/lib/sampleData";

const knownSkus = { "SKU-1": { name: "Product 1", shelf: 12 } };
const knownChannels = { Blinkit: { type: "fixed" as const, val: 6 } };

describe("parseDemandCsv", () => {
  it("parses valid rows, including the gate pass number", () => {
    const { demand, badSku, badChannel, badQty, badGatePass } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" }]);
    expect(badSku).toEqual([]);
    expect(badChannel).toEqual([]);
    expect(badQty).toEqual([]);
    expect(badGatePass).toEqual([]);
  });

  it("merges duplicate channel+SKU+gate-pass rows by summing quantity, and reports the merge", () => {
    const { demand, duplicatesMerged } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001\nBlinkit, SKU-1, 5, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 25, gatePassNo: "GP-1001" }]);
    expect(duplicatesMerged).toEqual(["Blinkit / SKU-1 / GP-1001"]);
  });

  it("keeps the same channel+SKU as two separate rows when the gate pass differs", () => {
    const { demand, duplicatesMerged } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001\nBlinkit, SKU-1, 5, GP-1002", knownSkus, knownChannels);
    expect(demand).toEqual([
      { channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" },
      { channel: "Blinkit", sku: "SKU-1", qty: 5, gatePassNo: "GP-1002" },
    ]);
    expect(duplicatesMerged).toEqual([]);
  });

  it("reports an unknown channel instead of parsing the row", () => {
    const { demand, badChannel } = parseDemandCsv("Nowhere, SKU-1, 10, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([]);
    expect(badChannel).toEqual(["Nowhere"]);
  });

  it("reports an unknown SKU instead of parsing the row", () => {
    const { demand, badSku } = parseDemandCsv("Blinkit, SKU-999, 10, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([]);
    expect(badSku).toEqual(["SKU-999"]);
  });

  it("reports an invalid quantity instead of silently dropping the row", () => {
    const { demand, badQty } = parseDemandCsv("Blinkit, SKU-1, 0, GP-1001\nBlinkit, SKU-1, abc, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([]);
    expect(badQty).toEqual(["Blinkit / SKU-1", "Blinkit / SKU-1"]);
  });

  it("reports a missing gate pass number instead of silently dropping the row", () => {
    const { demand, badGatePass } = parseDemandCsv("Blinkit, SKU-1, 20, ", knownSkus, knownChannels);
    expect(demand).toEqual([]);
    expect(badGatePass).toEqual(["Blinkit / SKU-1"]);
  });
});
