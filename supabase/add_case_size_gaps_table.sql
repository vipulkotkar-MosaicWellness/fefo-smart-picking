-- supabase/add_case_size_gaps_table.sql
--
-- FEFO Smart Picking — tracks every real order placed for a SKU that had no
-- configured case size at the time, so the Admin gap dashboard (see
-- add_case_sizes_table.sql for the sibling case_sizes table) can show real,
-- volume-ranked, order-driven gaps instead of a silent "not covered yet".
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.

create table if not exists case_size_gaps (
  sku            text primary key,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  occurrences    integer not null default 0,
  total_qty      integer not null default 0
);

alter table case_size_gaps enable row level security;

create policy "read case size gaps" on case_size_gaps for select to authenticated using (true);

-- Written automatically by generate() as a side effect of a real order, so
-- any role that can create a picklist (planner/admin/super_admin) needs
-- write access here — not just Admin, unlike case_sizes itself.
create policy "log case size gaps" on case_size_gaps for insert to authenticated with check (true);
create policy "update case size gaps" on case_size_gaps for update to authenticated using (true) with check (true);
