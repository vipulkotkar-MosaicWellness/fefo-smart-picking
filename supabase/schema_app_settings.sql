-- FEFO Smart Picking — app_settings table
-- Run in Supabase → SQL Editor, AFTER schema_step3_complete.sql.
--
-- A tiny generic key/value table for shared, Super-Admin-only app settings
-- that aren't per-channel (channel_overrides already covers those) — first
-- use: auto_complete_after_days, the aged-WMS-blocked-picklist auto-close
-- timer. Reuses current_role_name() already defined in schema_step3_complete.sql.

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table app_settings enable row level security;

create policy "authenticated read" on app_settings
  for select to authenticated using (true);

create policy "super admin write" on app_settings
  for all to authenticated
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

alter publication supabase_realtime add table app_settings;
