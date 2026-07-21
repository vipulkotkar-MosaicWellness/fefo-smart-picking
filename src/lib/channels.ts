import type { ChannelRule } from "./types";

// Channel-wise dispatch tolerance. Editable in one place.
// fixed = minimum months of remaining shelf life the channel accepts.
// pct   = minimum remaining shelf life as a fraction of total shelf life.
export const CHANNELS: Record<string, ChannelRule> = {
  "Internal Stock Transfer": { type: "pct", val: 0.65 },
  Amazon: { type: "fixed", val: 6 },
  Flipkart: { type: "fixed", val: 6 },
  "FK Hub": { type: "fixed", val: 6 },
  Pillbox: { type: "fixed", val: 6 },
  "RK World": { type: "fixed", val: 6 },
  Myntra: { type: "fixed", val: 13 },
  Nykaa: { type: "fixed", val: 13 },
  Purplle: { type: "fixed", val: 13 },
  Blinkit: { type: "pct", val: 0.75 },
  Zepto: { type: "pct", val: 0.75 },
  Instamart: { type: "pct", val: 0.75 },
  "Amazon Now": { type: "pct", val: 0.75 },
  Apollo: { type: "pct", val: 0.75 },
  "TATA 1MG": { type: "pct", val: 0.75 },
  "Wellness Forever": { type: "pct", val: 0.75 },
  "Health & Glow": { type: "pct", val: 0.75 },
  "Reliance Retail": { type: "pct", val: 0.75 },
};

export function ruleText(channel: string): string {
  const r = CHANNELS[channel];
  if (!r) return "";
  return r.type === "fixed"
    ? `≥ ${r.val} months remaining`
    : `≥ ${r.val * 100}% of shelf life remaining`;
}
