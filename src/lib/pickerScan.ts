/** Whether a scanned/typed code matches the batch this pick line expects. */
export function scanMatches(scanned: string, expectedBatch: string): boolean {
  const s = scanned.trim().toLowerCase();
  if (!s) return false;
  return s === expectedBatch.trim().toLowerCase();
}
