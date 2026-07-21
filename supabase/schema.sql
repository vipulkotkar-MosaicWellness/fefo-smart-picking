-- FEFO Smart Picking — Supabase / PostgreSQL schema
-- Run this in the Supabase dashboard -> SQL Editor to create the backend.
-- The web app enforces FEFO + tolerance; the database enforces the shared-state
-- rules (soft-block reservations and master-picklist inventory freeze).

-- ---------- reference: channel dispatch tolerance (editable) ----------
create table if not exists channels (
  name        text primary key,
  rule_type   text not null check (rule_type in ('fixed', 'pct')),
  rule_val    numeric not null   -- fixed = months; pct = fraction of shelf life
);

-- ---------- stock (one row per batch per bin) ----------
create table if not exists stock (
  rid         bigint generated always as identity primary key,
  location    text not null,
  bin         text not null,
  sku         text not null,
  name        text not null,
  batch       text not null,
  expiry      date not null,
  qty         integer not null check (qty >= 0),
  shelf       integer not null,          -- total shelf life in months
  inv_type    text not null default 'Good',
  active      text not null default 'Active',
  updated_at  timestamptz not null default now()
);
create index if not exists stock_loc_sku on stock (location, sku);

-- ---------- master picklists ----------
create table if not exists master_picklists (
  no            text primary key,
  channel       text not null,
  location      text not null,
  status        text not null default 'open' check (status in ('open', 'completed')),
  bad           integer not null default 0,
  gatepass      text,
  picked_total  integer,
  demand        jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- ---------- picklist lines ----------
create table if not exists picklist_lines (
  id          bigint generated always as identity primary key,
  mpl_no      text not null references master_picklists (no) on delete cascade,
  rid         bigint references stock (rid),
  sku         text not null,
  name        text not null,
  bin         text,
  batch       text,
  expiry      date,
  rem_months  integer,
  qty         integer not null default 0,   -- suggested pick qty
  nf          integer,                       -- not-found qty at completion
  picked      integer,                       -- qty - nf
  no_elig     boolean not null default false,
  short_line  boolean not null default false
);
create index if not exists lines_mpl on picklist_lines (mpl_no);

-- ---------- SOFT-BLOCK: reserved qty per stock row across OPEN picklists ----------
create or replace view reserved_stock as
select l.rid,
       coalesce(sum(l.qty), 0) as reserved
from picklist_lines l
join master_picklists m on m.no = l.mpl_no
where m.status = 'open'
  and l.no_elig = false
  and l.short_line = false
  and l.rid is not null
group by l.rid;

-- available = on-hand minus soft-blocked
create or replace view stock_available as
select s.*, coalesce(r.reserved, 0) as reserved,
       s.qty - coalesce(r.reserved, 0) as available
from stock s
left join reserved_stock r on r.rid = s.rid;

-- ---------- INVENTORY FREEZE helper: is any master picklist open? ----------
create or replace view feed_frozen as
select exists (select 1 from master_picklists where status = 'open') as frozen;

-- ---------- Row Level Security (enable, then add role policies) ----------
-- alter table stock enable row level security;
-- alter table master_picklists enable row level security;
-- alter table picklist_lines enable row level security;
-- Example: allow authenticated users to read; restrict writes by role claim.
-- create policy "read stock" on stock for select to authenticated using (true);
