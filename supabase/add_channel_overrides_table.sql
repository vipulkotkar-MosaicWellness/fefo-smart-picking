-- FEFO Smart Picking — shared channel config (rules, custom channels, deletions)
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.
--
-- Fixes: channels added or edited via Admin only existed in that browser's
-- local storage, so nobody else ever saw them (real report: "I have created
-- channels but not visible to others"). This makes channel config a real
-- shared table like `pickers`, with Realtime so it updates live everywhere.
--
-- One row per channel actually touched by an Admin — either a rule edit to
-- a built-in channel (see src/lib/channels.ts CHANNELS), or a brand-new
-- custom channel (bucket set), or a deletion (deleted = true). Channels
-- nobody has ever touched simply have no row here and keep using the
-- built-in defaults baked into the app — no need to mirror those.

create table if not exists channel_overrides (
  name        text primary key,
  bucket      text,                                    -- set only for an Admin-added custom channel; null for a rule-only edit to a built-in channel
  rule_type   text not null check (rule_type in ('fixed', 'pct')),
  rule_val    numeric not null,
  min_bin_qty integer,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table channel_overrides enable row level security;

create policy "read channel overrides" on channel_overrides for select to authenticated using (true);

-- Only Admin/Super Admin can add, edit, or delete a channel — matches who
-- can reach the Channel dispatch tolerance card in the app's Admin screen.
create policy "admin manage channel overrides" on channel_overrides for all to authenticated
  using (current_role_name() in ('admin', 'super_admin'))
  with check (current_role_name() in ('admin', 'super_admin'));

alter publication supabase_realtime add table channel_overrides;
