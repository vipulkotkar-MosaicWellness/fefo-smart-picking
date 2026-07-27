-- FEFO Smart Picking — Supabase schema
-- Run this in Supabase → SQL Editor (project kytktvvcbgslwokywmds).
-- The Apps Script (service key) writes stock; the web app (anon key) reads it.

-- ============ STOCK (refreshed from the Shelfwise email) ============
create table if not exists stock (
  id         bigint generated always as identity primary key,
  facility   text not null,          -- Facility (CSV col A)
  bin        text not null,          -- Shelf / bin (CSV col E)
  sku        text not null,          -- Item Type SKU Code (col B)
  name       text not null,          -- Item Type Name (col C)
  batch      text,                   -- Batch Code (col P)
  expiry     date,                   -- Expiry (col Q)
  qty        integer not null,       -- Quantity (col J)
  shelf      integer not null,       -- total shelf life months (Mfg→Expiry)
  updated_at timestamptz not null default now()
);
create index if not exists stock_fac_sku on stock (facility, sku);

-- one-row table holding the last sync time / status shown in the app header
create table if not exists sync_state (
  id           int primary key default 1,
  last_synced  timestamptz,
  rows         integer,
  status       text
);
insert into sync_state (id) values (1) on conflict (id) do nothing;

-- ============ Read access for the web app (anon key) ============
alter table stock enable row level security;
alter table sync_state enable row level security;
create policy "public read stock" on stock for select to anon, authenticated using (true);
create policy "public read sync" on sync_state for select to anon, authenticated using (true);
-- Writes are done only by the Apps Script using the service_role key, which
-- bypasses RLS — so no insert/update policies are needed here.

-- ============ (Phase B step 3) picking tasks — created now, used later ============
create table if not exists picking_tasks (
  no          text primary key,
  channel     text not null,
  demand      jsonb not null default '[]',
  shortfall   jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
create table if not exists facility_picklists (
  no            text primary key,
  task_no       text not null references picking_tasks (no) on delete cascade,
  facility      text not null,
  round         int not null default 1,
  status        text not null default 'open',
  gatepass      text,
  picked_total  integer,
  bad           integer not null default 0
);
create table if not exists pick_lines (
  id          bigint generated always as identity primary key,
  picklist_no text not null references facility_picklists (no) on delete cascade,
  rid         bigint,
  sku         text, name text, bin text, batch text,
  expiry date, rem_months int,
  qty int not null default 0,
  picker text, nf int, picked int
);

-- Enable RLS on the task tables too. No policies yet = locked to public (anon /
-- authenticated) keys; only the service_role key (Apps Script) can touch them.
-- Read/write policies for the app are added in step 3 (with roles/auth).
alter table picking_tasks enable row level security;
alter table facility_picklists enable row level security;
alter table pick_lines enable row level security;

-- "is any picklist still being picked?" — for the ingestion freeze in step 3
create or replace view feed_frozen as
select exists (
  select 1 from pick_lines l join facility_picklists f on f.no = l.picklist_no
  where f.status = 'open' and l.picked is null
) as frozen;
