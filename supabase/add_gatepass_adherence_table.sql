-- FEFO Smart Picking — Gate Pass Adherence tracking
-- Run this in Supabase → SQL Editor (project kytktvvcbgslwokywmds), AFTER
-- schema.sql and schema_step3_complete.sql have already been run.
--
-- Populated by apps-script/GatepassAdherenceCheck.gs on a daily trigger — it
-- compares what each gate pass was INSTRUCTED to pick (from this app's own
-- `tasks` data) against what Uniware's "Gatepass All Facility" export says
-- was actually picked, keyed on gate pass + batch + bin. A line with no
-- matching bin in the actual data means the picker took the SKU from a
-- different bin than instructed — FEFO non-compliance. Over-picking from the
-- correct bin is not penalized (see `lines` breakdown for the per-line
-- reasoning); only under-picking or wrong-bin picking lowers adherence_pct.

create table if not exists gatepass_adherence (
  id              bigint generated always as identity primary key,
  gatepass_code   text not null,
  facility        text not null,        -- SL Mother Hub | SL Ambient | SL RX
  report_date     date not null,        -- the "yesterday" this row covers (gate pass Updated At date)
  instructed_qty  integer not null,
  compliant_qty   integer not null,
  adherence_pct   numeric(5,2) not null,
  lines           jsonb not null,       -- [{sku, bin, batch, instructed_qty, actual_qty, compliant_qty, status}]
  created_at      timestamptz not null default now(),
  unique (gatepass_code, report_date)
);
create index if not exists gatepass_adherence_report_date on gatepass_adherence (report_date);

alter table gatepass_adherence enable row level security;
create policy "read gatepass adherence" on gatepass_adherence for select to anon, authenticated using (true);
-- Writes are done only by the Apps Script using the service_role key, which
-- bypasses RLS — so no insert/update policy is needed here (same pattern as `stock`).
