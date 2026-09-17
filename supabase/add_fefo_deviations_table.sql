-- supabase/add_fefo_deviations_table.sql
--
-- FEFO Smart Picking — records, per real order, every lot where case-first
-- allocation took MORE units than strict FEFO would have on the same stock
-- snapshot (see computeFefoDeviation in src/lib/fefoDeviation.ts). This is
-- the raw data behind the "Case-based + FEFO breach" metric on the Gate
-- Pass Adherence screen — see
-- docs/superpowers/specs/2026-09-17-fefo-purity-reporting-design.md.
-- Run this in Supabase → SQL Editor, AFTER schema.sql and
-- schema_step3_complete.sql have already been run.

create table if not exists fefo_deviations (
  id             bigint generated always as identity primary key,
  -- Nullable: a facility still sitting in "Gate Pass Allocation Pending" at
  -- generate() time has no gate pass number yet. Such rows simply won't
  -- join against gatepass_adherence until (if ever) one is added — see the
  -- design doc's note on this being an accepted, soft-visibility gap.
  gate_pass_no   text,
  facility       text not null,
  sku            text not null,
  bin            text not null,
  batch          text not null,
  deviation_qty  integer not null check (deviation_qty > 0),
  created_at     timestamptz not null default now()
);

-- Backs the reporting screen's `.gte("created_at", sinceDate)` window filter
-- — same reasoning as gatepass_adherence_report_date on gatepass_adherence.
create index if not exists fefo_deviations_created_at on fefo_deviations (created_at);

alter table fefo_deviations enable row level security;

create policy "read fefo deviations" on fefo_deviations for select to authenticated using (true);

-- Written automatically by generate() as a side effect of a real order, so
-- any role that can create a picklist (planner/admin/super_admin) needs
-- write access here — same reasoning as case_size_gaps.
create policy "log fefo deviations" on fefo_deviations for insert to authenticated with check (true);
