-- Adds the "counted exactly once" flag to gatepass_adherence.
-- Run this in Supabase -> SQL Editor FIRST, before running
-- cleanupDuplicatePerformanceFlags() in Apps Script.
--
-- A gate pass legitimately gets touched more than once in Uniware — e.g.
-- marked RETURN_AWAITED when the invoice is generated and it's ready for
-- dispatch (this is the moment the FEFO/picking decision was actually
-- made), then again later when the receiving side reviews the receipt and
-- it's marked CLOSED (a downstream admin step that reflects nothing about
-- picking). Every touch still gets its own row here — nothing is ever
-- deleted, so the full history stays available for audit — but only ONE
-- of them, the EARLIEST, should ever count toward FEFO performance.
--
-- Every report, chart, and the daily digest email reads only
-- used_for_performance = true rows. See apps-script/GatepassAdherenceCheck.gs
-- (gpaAssignUsedForPerformance_ for the go-forward rule,
-- cleanupDuplicatePerformanceFlags for the one-time historical fix).

alter table gatepass_adherence
  add column if not exists used_for_performance boolean not null default true;

create index if not exists gatepass_adherence_used_for_performance
  on gatepass_adherence (used_for_performance);
