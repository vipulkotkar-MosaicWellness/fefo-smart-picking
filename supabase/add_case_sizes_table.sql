-- supabase/add_case_sizes_table.sql
--
-- FEFO Smart Picking — case pack sizes (Phase 1 of case-based picking).
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.
--
-- One row per SKU that has a known case pack size. A SKU with no row here
-- behaves exactly as today (plain per-unit FEFO, no case/each split) — see
-- allocate() in engine.ts. Same shared-table + Realtime pattern as
-- channel_overrides (add_channel_overrides_table.sql), so an Admin edit
-- reaches every browser live instead of being stuck in local storage.

create table if not exists case_sizes (
  sku        text primary key,
  case_size  integer not null check (case_size > 1),
  updated_at timestamptz not null default now()
);

alter table case_sizes enable row level security;

create policy "read case sizes" on case_sizes for select to authenticated using (true);

-- Only Admin/Super Admin can add, edit, or remove a case size — same access
-- model as channel dispatch tolerance.
create policy "admin manage case sizes" on case_sizes for all to authenticated
  using (current_role_name() in ('admin', 'super_admin'))
  with check (current_role_name() in ('admin', 'super_admin'));

alter publication supabase_realtime add table case_sizes;
