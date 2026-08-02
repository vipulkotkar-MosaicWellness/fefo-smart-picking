import { COGS_SNAPSHOT } from "./cogsSnapshot";

/** Cost of goods for a SKU, or undefined if not in the cost sheet. */
export function unitPrice(sku: string): number | undefined {
  return COGS_SNAPSHOT[sku];
}
