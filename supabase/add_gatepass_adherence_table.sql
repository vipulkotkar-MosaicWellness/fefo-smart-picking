-- FEFO Smart Picking — Gate Pass Adherence tracking
-- Run this in Supabase → SQL Editor (project kytktvvcbgslwokywmds), AFTER
-- schema.sql and schema_step3_complete.sql have already been run.
--
-- Populated by apps-script/GatepassAdherenceCheck.gs on a daily trigger — it
-- compares what each gate pass was INSTRUCTED to pick (from this app's own
-- `tasks` data) against what Uniware's "Gatepass All Facility" export says
-- was actually picked. Scored on BATCH only: picking the instructed batch
-- from a different shelf is still FEFO compliance. A line lowers
-- adherence_pct only when a different batch was picked, nothing was picked,
-- or the correct batch was short-picked (only the picked units are
-- credited). Over-picking the correct batch is capped, not rewarded.
-- Non-expiry SKUs (hardcoded list in the script) always score 100%.
-- See the script's SCORING RULES header and the `lines` breakdown
-- (fefo_breach / reason / bin_match per line) for the per-line reasoning.

create table if not exists gatepass_adherence (
  id              bigint generated always as identity primary key,
  gatepass_code   text not null,
  facility        text not null,        -- SL Mother Hub | SL Ambient | SL RX
  report_date     date not null,        -- the "yesterday" this row covers (gate pass Updated At date)
  instructed_qty  integer not null,
  compliant_qty   integer not null,
  adherence_pct   numeric(5,2) not null,
  lines           jsonb not null,       -- [{sku, name, bin, batch, instructed_qty, actual_qty, compliant_qty, fefo_breach, reason, bin_match, picked_bin_batch, vendor_batch}]  (pre-Sep-2026 rows: `status` instead of fefo_breach/reason, until re-scored by backfillAllGatepassAdherence())
  created_at      timestamptz not null default now(),
  unique (gatepass_code, report_date)
);
create index if not exists gatepass_adherence_report_date on gatepass_adherence (report_date);

alter table gatepass_adherence enable row level security;
create policy "read gatepass adherence" on gatepass_adherence for select to anon, authenticated using (true);
-- Writes are done only by the Apps Script using the service_role key, which
-- bypasses RLS — so no insert/update policy is needed here (same pattern as `stock`).
