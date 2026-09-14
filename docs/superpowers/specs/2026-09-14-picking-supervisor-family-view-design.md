# Picking Supervisor: Filters + Round History Design

## Problem

Picking Supervisor organizes picklists by pipeline stage (Picking Pending / Inventory Blocked / Not Found / Completed), which is correct for triage but has two real gaps confirmed this session:

1. **No way to see a gate pass's full history in one place.** When a not-found event creates a re-offer (Round 2, Round 3...), the original and its re-offers land in whatever bucket each currently sits in — scattered, not connected. A supervisor looking at one entry has no way to tell how many rounds preceded it, or whether an earlier round moved to a different facility. Picklist Repository already solves this (grouped "family" cards with round tabs) but that's a separate historical-archive screen, not the operational triage screen.
2. **Filtering is coarse.** Facility/channel/picker dropdowns exist today, but there's no way to filter by a broader Business Type grouping (~85 channels roll up into 5 real business categories), and date filtering is limited to broad presets (Today/Yesterday/Last 7/Last 30) rather than the specific recent days a supervisor actually needs (Yesterday-2, Yesterday-3, Yesterday-4).

**Explicitly out of scope for this spec:** the "Gatepass report" external reconciliation trigger (auto-completing a picklist when an external Uniware/WMS report shows "return awaited" status) — confirmed as a separate subsystem needing its own design pass once this ships.

## Design

### 1. Keep the 4 stage sections; add filters on top

The existing structure (Picking Pending / Gatepass Generated — Inventory Blocked (WMS) / Not Found — Needs an Alternate / Picking Completed) stays exactly as it is today — all 4 always visible, each independently collapsible, matching current behavior. No stage gets removed, split, or renamed. This was explicitly re-confirmed after considering and rejecting alternatives (a flat single-status list, an invented "Gate Pass generated" middle stage, removing Not Found as a section).

A filter bar sits above the 4 sections with four controls: **Date, Facility, Status, Business Type**. "Status" here filters which of the 4 sections have visible content (not a replacement for the sections themselves) — selecting a status narrows the relevant section(s), it does not collapse to a flat list.

- **Date**: existing `AgeingFilter` presets (Today/Yesterday/Last 7/Last 30/Custom) gain explicit Yesterday-2/Yesterday-3/Yesterday-4 presets, addressing the specific "gate passes span different dates across facilities" complaint.
- **Facility**: unchanged from today (SL Mother Hub / SL Ambient / SL RX).
- **Status**: Picking Pending / Inventory Blocked / Not Found / Completed — maps 1:1 to the 4 existing sections.
- **Business Type**: new filter, see below.

### 2. Business Type filter (filter-only, no numbering impact)

A new, more complete channel→business-type mapping (supplied by Vipul, covers ~85 channels vs. the ~30 covered by today's `CHANNEL_BUCKETS`) becomes a new filter dimension:

- Internal Stock Transfer - Warehouse - 3PL
- Internal Stock Transfer - Warehouse - Local
- Internal Stock Transfer - Dark Stores
- B2B Ecommerce + Q-Commerce
- B2B MT+ GT

The full mapping is saved verbatim at `docs/superpowers/specs/2026-09-14-business-type-mapping.csv` for the implementer to load directly rather than re-typing it.

**Coverage caveat found during spec review, not yet resolved:** this mapping, while much more complete than today's `CHANNEL_BUCKETS`, doesn't obviously cover every channel seen live in the app — e.g. a plain "Internal Stock Transfer - Warehouse" (distinct from the "-3PL"/"-Local" variants) and "Internal Stock Transfer - NCR" were both observed in the live channel dropdown earlier this session but don't appear in the supplied table. Implementation needs a defined fallback for any channel not in the mapping — an explicit "Other / Unmapped" filter option is the safest default (never silently hide a picklist because its channel wasn't in the table) rather than assuming the table is exhaustive.

**Explicitly confirmed:** this is filter-only. It does NOT replace or update `CHANNEL_BUCKETS` in `channels.ts`, and does NOT change picklist numbering prefixes (`REPL-`/`B2BE-`/`B2BO-`/`GEN-`). The existing numbering gap (channels missing from `CHANNEL_BUCKETS` falling back to `GEN-`) is a real, separate issue, noted but deliberately not fixed here — fixing it would mean this mapping becomes the numbering source of truth, which was explicitly declined in favor of the lower-risk filter-only option.

### 3. Round-history tab switcher, reused across all 4 sections

Wherever a picklist belongs to a multi-round family (an original plus one or more not-found re-offers), it gets the same round-tab switcher already proven in Picklist Repository (`groupPicklistFamilies` in `picklistFamilies.ts`) — reused, not rebuilt. This applies uniformly across all 4 stage sections, not just one: if a Round 3 re-offer is currently sitting in "Inventory Blocked," opening it shows the same Original/Round 2/Round 3 tabs a supervisor would see for it in Repository.

**Default tab:** opens on **Original (Round 1)**, not the latest round. This corrects an actual bug in the current Repository behavior, which defaults to `family.rounds[family.rounds.length - 1]` (the *latest* round) — meaning a supervisor currently lands on "Round 3 / Not Found" first, before ever seeing what the order originally looked like. Confirmed this should flip to defaulting on Round 1 everywhere the switcher appears.

**Facility-change visibility:** each round tab is labeled with its own facility (e.g. "Round 2 · SL Ambient", "Round 3 · SL Mother Hub"), so a facility change between rounds is visible just by reading across the tabs — no separate lookup needed.

**Color treatment:** deliberately restrained, reusing the app's existing 4 semantic tones (`ok`/`warn`/`bad`/`info` — see `Ui.tsx`'s `Tag` component) rather than inventing new colors per state:
- One accent color (teal, matching the existing active-tab convention) for the currently-selected round tab.
- Neutral gray/white for all other round tabs.
- A single small amber dot (●) as the *only* additional marker, appearing on a tab when that round's facility differs from the previous round's — not a full color change, not one color per state.

### 4. New data field: `reofferedFrom`

**The problem it fixes:** `groupPicklistFamilies` currently links rounds together by stripping the `-R2`/`-R3` suffix from a facility picklist's own number (`primaryFacilityNo`) — which only works when a re-offer lands on the *same* facility as the round before it. When a re-offer is sent to a *different* facility (deliberate, correct FEFO behavter when that's where the leftover stock actually was), it currently shows up as a completely separate, unlinked family — defeating the entire point of this feature for exactly the cases where knowing "it moved facilities" matters most.

**The fix:** stamp a new optional field, `reofferedFrom?: string`, onto a round-2+ `FacilityPicklist` at the moment it's created — the exact facility-picklist number (`.no`) of the shortfall round that triggered it. This information already exists in scope at creation time (it's the `completedFacility` in the not-found re-offer logic in `store.ts`) — it has just never been persisted.

`groupPicklistFamilies` then links a round to its family by following the `reofferedFrom` chain when present, falling back to the existing same-facility-suffix heuristic when it's absent (i.e., for all historical data created before this ships).

**Confirmed limitation, accepted as-is:** historical re-offers created before this ships have no way to recover this trace after the fact. They'll continue to rely on the same-facility-suffix guess exactly as today — no backfill is possible or planned.

### 5. Internal reference number de-emphasis

Addresses the earlier-flagged confusion between the real, customer-facing gate pass number and the internal-only `gp` tracking code (`FacilityBlock.tsx`, stamped only at completion). Within the family card header, the real gate pass number stays the prominent, bold element; the internal `gp` code (when present) is shown small and muted, explicitly labeled "Internal ref: GP-xxxxxx" rather than unlabeled "Gatepass GP-xxxxxx" — so it's never mistaken for a second real gate pass number.

## Explicitly confirmed out of scope

- Merging Picking Supervisor and Picklist Repository into one screen (considered, rejected — they serve different jobs: triage vs. audit/lookup).
- Splitting "Inventory Blocked" into a separate "Gate Pass generated" stage (considered, dropped — no real distinguishable state exists in the data for it).
- Removing "Not Found — Needs Alternate" as a visible section (considered, rejected — the passive visibility it provides is worth keeping).
- Updating `CHANNEL_BUCKETS`/task numbering to match the new Business Type mapping (considered, deferred — filter-only for now).
- The Gatepass report external reconciliation auto-complete trigger (separate subsystem, separate design conversation, after this ships).
- Backfilling `reofferedFrom` for historical re-offers (not possible after the fact for cross-facility cases).

## Open items for implementation planning

- Exact wording/placement of the Yesterday-2/3/4 date presets in the existing `AgeingFilter` component.
- Whether `reofferedFrom` needs a Supabase schema migration or can live purely in the existing JSONB `tasks.data` blob (likely the latter, consistent with how the rest of `FacilityPicklist` is stored).
- Test coverage: `groupPicklistFamilies` chain-following logic, default-round-1 behavior, facility-change dot logic, Business Type filter predicate.
