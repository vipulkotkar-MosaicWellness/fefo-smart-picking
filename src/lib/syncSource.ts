export type SyncSource = "email" | "manual" | null;

export interface SyncSourceLabel {
  text: string;
  tone: "info" | "warn" | "muted";
}

/**
 * How to show "where did the current stock data come from" — deliberately
 * distinct wording and tone (email = calm/blue, manual = attention/amber) so
 * a supervisor can tell at a glance whether they're looking at the automated
 * feed or a one-off manual override, without reading closely.
 */
export function syncSourceLabel(source: SyncSource, updatedBy: string | null): SyncSourceLabel {
  if (source === "email") return { text: "Synced from email", tone: "info" };
  if (source === "manual") {
    return { text: updatedBy ? `Manually uploaded by ${updatedBy}` : "Manually uploaded", tone: "warn" };
  }
  return { text: "Synced", tone: "muted" };
}
