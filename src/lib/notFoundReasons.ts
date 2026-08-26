/**
 * Shared "not found" reason buckets — used by both the Picker's own mobile
 * completion flow (PickerView.tsx) and the Supervisor's completion screen
 * (FacilityBlock.tsx), so a not-found qty gets the same reason options and
 * the same bucket names no matter who records it. Feeds notFoundSummary.ts's
 * byReason breakdown directly (it just groups on this string), so adding a
 * reason here immediately shows up as its own bucket in the Not Found report
 * — no other wiring needed.
 */
export const NOT_FOUND_REASONS = [
  "Not enough stock",
  "Batch not found",
  "Batch mismatch",
  "Damaged stock",
  "B2B sales return stock",
  "Location blocked",
  "Other",
] as const;
