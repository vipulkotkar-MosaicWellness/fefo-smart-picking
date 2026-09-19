-- stock_holds has no tracked migration at all (see Task 17, the RLS decision
-- task) — the table was created by hand in the dashboard. Realtime delivery
-- is opt-in per table in Supabase, so subscribeHolds() in
-- src/lib/holdsSupabase.ts silently receives nothing until stock_holds is
-- added to the publication, exactly like pickers / channel_overrides /
-- app_settings / tasks already are.
--
-- Run this in Supabase -> SQL Editor. Safe to re-run: the DO block skips the
-- table if it is already published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_holds'
  ) then
    alter publication supabase_realtime add table stock_holds;
  end if;
end $$;

-- Realtime needs the full old row on UPDATE/DELETE to build its payload;
-- without this a release (an UPDATE setting released_at) delivers only the
-- primary key.
alter table stock_holds replica identity full;
