import { describe, expect, it } from "vitest";
import { parseDemandCsv } from "../../src/lib/sampleData";

const knownSkus = { "SKU-1": { name: "Product 1", shelf: 12 } };
const knownChannels = { Blinkit: { type: "fixed" as const, val: 6 } };

describe("parseDemandCsv", () => {
  it("parses valid rows, including the gate pass number", () => {
    const { demand, badSku, badChannel, badQty } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" }]);
    expect(badSku).toEqual([]);
    expect(badChannel).toEqual([]);
    expect(badQty).toEqual([]);
  });

  it("parses a row with no gate pass number at all — it's optional now", () => {
    const { demand } = parseDemandCsv("Blinkit, SKU-1, 20", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: undefined }]);
  });

  it("parses a row with a trailing comma but a blank gate pass the same way as no 4th column", () => {
    const { demand } = parseDemandCsv("Blinkit, SKU-1, 20, ", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: undefined }]);
  });

  it("merges duplicate channel+SKU+gate-pass rows by summing quantity, and reports the merge", () => {
    const { demand, duplicatesMerged } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001\nBlinkit, SKU-1, 5, GP-1001", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 25, gatePassNo: "GP-1001" }]);
    expect(duplicatesMerged).toEqual(["Blinkit / SKU-1 / GP-1001"]);
  });

  it("merges two blank-gate-pass rows for the same channel+SKU too — they're the same pending order", () => {
    const { demand, duplicatesMerged } = parseDemandCsv("Blinkit, SKU-1, 20\nBlinkit, SKU-1, 5", knownSkus, knownChannels);
    expect(demand).toEqual([{ channel: "Blinkit", sku: "SKU-1", qty: 25, gatePassNo: undefined }]);
    expect(duplicatesMerged).toEqual(["Blinkit / SKU-1 / __PENDING__"]);
  });

  it("keeps the same channel+SKU as two separate rows when the gate pass differs", () => {
    const { demand, duplicatesMerged } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001\nBlinkit, SKU-1, 5, GP-1002", knownSkus, knownChannels);
    expect(demand).toEqual([
      { channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" },
      { channel: "Blinkit", sku: "SKU-1", qty: 5, gatePassNo: "GP-1002" },
    ]);
    expect(duplicatesMerged).toEqual([]);
  });

  it("keeps a blank-gate-pass row separate from one with an explicit gate pass, same channel+SKU", () => {
    const { demand } = parseDemandCsv("Blinkit, SKU-1, 20, GP-1001\nBlinkit, SKU-1, 5", knownSkus, knownChannels);
    expect(demand).toEqual([
      { channel: "Blinkit", sku: "SKU-1", qty: 20, gatePassNo: "GP-1001" },
      { channel: "Blinkit", sku: "SKU-1", qty: 5, gatePassNo: undefined },
    ]);
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
});
