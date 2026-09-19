# FEFO-Purity & Breach Reporting — Design

**Status:** Approved by Vipul Kotkar, 2026-09-17. Next step: implementation plan.

## Problem

Case-based picking (Phase 1) went live on 17 Sep 2026. Before launch, a one-time historical
simulation (25 Aug – 2 Sep) found that case-first allocation would cause ~0.92% of picked units
(8,080 of 880,905) to ship from a batch that wasn't actually the nearest-expiry one — management
approved the feature on that basis. That simulation was a one-off script run, not a live feature.

The existing **Gate Pass Adherence** screen ("Pick Compliance & Fulfillment Accuracy", currently
83% over 20 Aug – 16 Sep) measures something different: *was the instructed batch actually picked,
at the instructed quantity* — compliance to instruction. It does not check whether the instruction
itself was FEFO-optimal. Under case-based picking, a picker who correctly follows a case-first
instruction that selected a later-expiring lot still scores 100% compliant on today's metric. The
FEFO-purity cost management approved is therefore invisible in all production reporting, ongoing.

This spec adds a live layer that measures that cost, going forward, comparable in method to the
original 0.92% baseline.

## The two new metrics

Both computed only for real orders (`generate()`), never for Demand Planner previews — same
principle already established for gap logging (`case_size_gaps`).

### Metric 1 — Pure case-based %

The *existing* instruction-compliance metric, unchanged in method (same-shelf-different-bin not
penalized; wrong batch, missed pick, or short pick is), scoped to picklists generated under
case-based picking (17 Sep onward) instead of the old regime. No new computation — it's the
existing `GatepassAdherenceCheck.gs` pipeline's output, just displayed for the new date range.

### Metric 2 — Case-based + FEFO breach %

Metric 1, adjusted downward for units where the *instruction itself* deviated from strict FEFO —
independent of whether the picker followed the instruction correctly.

**Worked example** (case size 30, order of 100 units, 20 units sitting loose at earliest expiry):
- Case-first picks 3 full cases (90, from a later-expiring case-eligible lot) + 10 loose eaches
  (from the 20-unit earliest bin) = 100.
- Strict FEFO would have taken all 20 from the earliest bin, then 80 from case lots.
- **Breach = 10 units** — the delta between the two allocations. Attributable per line: the case
  line has 10 more than strict-FEFO would give it; the eaches line has 10 fewer.
- Separately, say 5 units failed real-world compliance (not found in the instructed bin, picker
  resourced elsewhere) → Metric 1 = 95%.
- **Combining is not free** unless the affected lines are checked: if the 5 compliance-miss units
  and the 10 breach units are on *different* lines, they're genuinely 15 distinct bad units → 85%.
  If they land on the *same* line, WMS doesn't serialize individual units, so we can't know whether
  they overlap — the true number is a range (best case 90%, worst case 85%).
- **Decision:** when breach and compliance-miss coexist on the same line, use the conservative
  (worst-case, assume-disjoint) bound. When they're on different lines — the more common case,
  since breach is fundamentally about which line a unit landed on, not a within-line defect — the
  join is exact, no assumption needed.

## Computation

**At `generate()` time**, for every real order, run the strict-FEFO allocation (`allocate()`
without `caseSize`) *in addition to* the real case-first allocation (`allocate()` with `caseSize`),
on the identical stock snapshot already in memory for that call. No new allocation algorithm —
`engine.ts` already supports both modes; this just calls it twice and diffs the results by
bin+batch per line.

Where the two allocations differ, persist the delta: which line(s) carried extra quantity under
case-first that strict-FEFO would have placed elsewhere, and how much. This is a new small table,
following the exact same pattern as `case_size_gaps` (Task 10 of the case-based-picking plan) —
written as a side effect of a real `generate()` call, soft-failing on error so logging can never
block real task creation.

**The next day**, the existing external pipeline (`GatepassAdherenceCheck.gs`, unchanged, not
touched by this work) scores actual picks against instructions as it already does, writing to the
existing `gatepass_adherence` table.

**The join** (breach data × compliance data, producing Metric 2) happens inside this app, at
dashboard-render time — not inside the external Apps Script. Keeps the fragile, already-flagged
external script untouched, and keeps the join logic in code we can test.

## Display — Gate Pass Adherence screen, restructured

**Top (new):** case-based era, from 17 Sep onward.
- Metric 1 card: graph (bar + connecting trendline, value labeled above each bar, date labeled
  below) + table. **Daily granularity, trailing 15 days.** Starts as a single day's bar and grows;
  format may move to weekly later once enough days accumulate, but not now — an explicit, deferred
  decision, not a default.
- Metric 2 card: same chart/table format, same 15-day daily window, directly below or beside
  Metric 1.

**Bottom (existing section, restructured):** pure-FEFO baseline, 20 Aug – 16 Sep, kept as a
separate historical record — never mixed with the new metrics above.
- Same bar + trendline chart format, but **weekly buckets** (currently ~4 weeks, all the history
  that exists — the table's earliest `report_date` is 2026-08-20, confirmed against live data).
- Existing best/worst-day cards and the daily log table stay as they are, beneath this.

## Out of scope

- Changing `GatepassAdherenceCheck.gs` in any way.
- Per-SKU drill-down on the breach metric (may be a natural follow-on, not part of this pass).
- Moving the top section to weekly buckets — deferred, revisit once more days of data exist.
- Unit-level (serialized) tracking to resolve the same-line overlap ambiguity precisely — accepted
  as a known limitation; the conservative bound is the agreed mitigation.
