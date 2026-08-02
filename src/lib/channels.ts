import type { ChannelRule } from "./types";

export type ChannelBucket = "Replenishment" | "B2B Ecom" | "B2B Offline";

// Channel-wise dispatch tolerance + bucket grouping. Editable in one place.
// fixed = minimum months of remaining shelf life the channel accepts.
// pct   = minimum remaining shelf life as a fraction of total shelf life.
export const CHANNEL_BUCKETS: Record<string, ChannelBucket> = {
  "Internal Stock Transfer - Warehouse": "Replenishment",
  "Internal Stock Transfer - Dark Stores": "Replenishment",
  Amazon: "B2B Ecom",
  Flipkart: "B2B Ecom",
  "FK Hub": "B2B Ecom",
  Pillbox: "B2B Ecom",
  "RK World": "B2B Ecom",
  Myntra: "B2B Ecom",
  Nykaa: "B2B Ecom",
  Purplle: "B2B Ecom",
  Blinkit: "B2B Ecom",
  Zepto: "B2B Ecom",
  Instamart: "B2B Ecom",
  "Amazon Now": "B2B Ecom",
  Apollo: "B2B Offline",
  "TATA 1MG": "B2B Offline",
  "Wellness Forever": "B2B Offline",
  "Health & Glow": "B2B Offline",
  "Reliance Retail": "B2B Offline",
};

export const CHANNELS: Record<string, ChannelRule> = {
  "Internal Stock Transfer - Warehouse": { type: "pct", val: 0.65 },
  "Internal Stock Transfer - Dark Stores": { type: "pct", val: 0.65 },
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

export function ruleText(r: ChannelRule | undefined): string {
  if (!r) return "";
  return r.type === "fixed"
    ? `≥ ${r.val} months remaining`
    : `≥ ${r.val * 100}% of shelf life remaining`;
}

// Short, filesystem/URL-safe codes used in picklist numbering.
const BUCKET_CODE: Record<ChannelBucket, string> = {
  Replenishment: "REPL",
  "B2B Ecom": "B2BE",
  "B2B Offline": "B2BO",
};

export function bucketCode(channel: string): string {
  const bucket = CHANNEL_BUCKETS[channel];
  return bucket ? BUCKET_CODE[bucket] : "GEN";
}

export function channelCode(channel: string): string {
  return channel
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
}
