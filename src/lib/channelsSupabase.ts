import type { ChannelRule } from "./types";
import { CHANNELS, type ChannelBucket } from "./channels";
import { supabase } from "./supabaseClient";

export interface ChannelOverrideRow {
  name: string;
  bucket: ChannelBucket | null;
  rule_type: "fixed" | "pct";
  rule_val: number;
  min_bin_qty: number | null;
  deleted: boolean;
}

/**
 * Applies every Admin-touched channel override on top of the built-in
 * CHANNELS/CHANNEL_BUCKETS defaults baked into the client bundle — a channel
 * nobody has ever edited/added/deleted simply has no row here and keeps
 * using its default straight from code, no sync needed. Pure/side-effect-
 * free so it's directly testable without a live Supabase connection.
 */
export function applyChannelOverrides(overrides: ChannelOverrideRow[]): {
  channelRules: Record<string, ChannelRule>;
  channelBuckets: Record<string, ChannelBucket>;
  deletedChannels: string[];
} {
  const channelRules: Record<string, ChannelRule> = { ...CHANNELS };
  const channelBuckets: Record<string, ChannelBucket> = {};
  const deletedChannels: string[] = [];
  for (const o of overrides) {
    if (o.deleted) {
      deletedChannels.push(o.name);
      delete channelRules[o.name];
      delete channelBuckets[o.name];
      continue;
    }
    channelRules[o.name] = { type: o.rule_type, val: o.rule_val, minBinQty: o.min_bin_qty ?? undefined };
    if (o.bucket) channelBuckets[o.name] = o.bucket;
  }
  return { channelRules, channelBuckets, deletedChannels };
}

export async function fetchChannelOverrides(): Promise<ChannelOverrideRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("channel_overrides").select("name,bucket,rule_type,rule_val,min_bin_qty,deleted");
  if (error) throw error;
  return (data ?? []) as ChannelOverrideRow[];
}

/** Upsert one channel's rule (and, for a new custom channel, its bucket). */
export async function upsertChannelOverride(name: string, rule: ChannelRule, bucket?: ChannelBucket): Promise<void> {
  if (!supabase) return;
  const row: Partial<ChannelOverrideRow> & { name: string } = {
    name,
    rule_type: rule.type,
    rule_val: rule.val,
    min_bin_qty: rule.minBinQty ?? null,
    deleted: false,
  };
  if (bucket) row.bucket = bucket;
  const { error } = await supabase.from("channel_overrides").upsert(row, { onConflict: "name" });
  if (error) throw error;
}

/**
 * Mark a channel deleted. Keeps the row (rather than removing it) so the
 * deletion itself is what syncs to every browser — deleting the row outright
 * would just let the built-in default (or a stale local cache) reappear.
 */
export async function markChannelOverrideDeleted(name: string, fallbackRule: ChannelRule): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("channel_overrides")
    .upsert({ name, rule_type: fallbackRule.type, rule_val: fallbackRule.val, min_bin_qty: fallbackRule.minBinQty ?? null, deleted: true }, { onConflict: "name" });
  if (error) throw error;
}

/** Refetch-on-any-change — the override set is small, so a full reload is simpler than diffing rows. */
export function subscribeChannelOverrides(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("channel-overrides-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "channel_overrides" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
