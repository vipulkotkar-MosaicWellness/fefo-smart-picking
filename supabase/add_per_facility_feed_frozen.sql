-- Per-facility inventory-sync freeze.
--
-- The old `feed_frozen` view returned one global boolean: "is ANY picklist,
-- anywhere across all 3 facilities, still being picked?" — so one open line
-- at, say, SL RX silently paused stock syncing for SL Mother Hub and SL
-- Ambient too, even though neither had anything open. On a busy day
-- something is open almost constantly somewhere, so the hourly sync could
-- go most of a day without ever finding a fully-clear moment (observed:
-- 2026-08-29, stock sat unsynced from 05:43 to past 17:00 for this exact
-- reason).
--
-- Replaced with a per-facility view: a set of the facility names that
-- currently have an open, unpicked line. The ingest script (see
-- apps-script/ShelfwiseIngest.gs) now syncs each of the 3 target facilities
-- independently, skipping only the ones that actually appear here.
drop view if exists feed_frozen;

create or replace view frozen_facilities as
select distinct f->>'facility' as facility
from tasks t,
  jsonb_array_elements(t.data->'facilities') f,
  jsonb_array_elements(f->'lines') l
where (f->>'status') = 'open'
  and (l->'picked') is null
  and coalesce((t.data->>'archived')::boolean, false) = false
  and coalesce((f->>'discarded')::boolean, false) = false
  and coalesce((f->>'wmsBlocked')::boolean, false) = false;

-- Companion to the above: each facility's stock rows now get replaced
-- independently (see ShelfwiseIngest.gs), so "last synced" is no longer one
-- single moment for the whole feed — it's whenever THAT facility's rows were
-- last freshly re-inserted. Powers the per-facility sync display in the app
-- header instead of one blended, potentially-misleading global timestamp.
create or replace view facility_last_synced as
select facility, max(updated_at) as last_synced
from stock
group by facility;
