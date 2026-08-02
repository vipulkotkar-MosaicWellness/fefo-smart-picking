-- FEFO Smart Picking — Phase B step 3: real logins + shared live picklists
-- Run this in Supabase → SQL Editor, AFTER schema.sql has already been run.
--
-- Design note: picking tasks are stored as ONE JSONB row per task (the same
-- shape the app already uses in memory: facilities[] -> lines[]) rather than
-- fully normalized tables. This is deliberately simple and robust — every
-- change to a task is a single atomic upsert, and Supabase Realtime pushes
-- that whole row to every connected user the moment it changes.

-- ============ drop the old, never-used relational task tables ============
drop view if exists feed_frozen;
drop table if exists pick_lines;
drop table if exists facility_picklists;
drop table if exists picking_tasks;

-- ============ profiles: one row per logged-in person, holds their role ============
create table if not exists profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null,
  role         text not null default 'pending' check (role in ('pending','admin','planner','supervisor','picker')),
  created_at   timestamptz not null default now()
);

-- Bootstrap: the very first person to ever sign up becomes admin automatically.
-- Everyone after that starts as 'pending' until an admin assigns their role.
create or replace function handle_new_user() returns trigger as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from profiles;
  insert into profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'pending' end
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: the calling user's own role, used inside RLS policies below.
create or replace function current_role_name() returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

alter table profiles enable row level security;
create policy "read all profiles" on profiles for select to authenticated using (true);
create policy "admin updates roles" on profiles for update to authenticated
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');
-- Users can update their own display name (but not their own role — the
-- check above only allows admins to write; this policy adds self-service
-- for the display_name field via the same UPDATE grant, enforced in the app).

-- ============ tasks: one JSONB row per picking task ============
create table if not exists tasks (
  no          text primary key,          -- e.g. B2BE-AMAZON-260729-001
  channel     text not null,
  bucket      text not null,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  data        jsonb not null             -- the full PickingTask object
);
create index if not exists tasks_created_at on tasks (created_at);

alter table tasks enable row level security;
create policy "read tasks" on tasks for select to authenticated using (true);
create policy "planner admin create tasks" on tasks for insert to authenticated
  with check (current_role_name() in ('planner','admin'));
create policy "assigned roles update tasks" on tasks for update to authenticated
  using (current_role_name() in ('planner','supervisor','admin','picker'))
  with check (current_role_name() in ('planner','supervisor','admin','picker'));

-- Keep updated_at current on every change (used to order/refresh the repository view).
create or replace function touch_tasks_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks
  for each row execute function touch_tasks_updated_at();

-- "is any picklist still being picked?" — drives the inventory-sync freeze
create or replace view feed_frozen as
select exists (
  select 1 from tasks t,
    jsonb_array_elements(t.data->'facilities') f,
    jsonb_array_elements(f->'lines') l
  where (f->>'status') = 'open' and (l->'picked') is null
) as frozen;

-- ============ enable Realtime so every logged-in user's screen updates live ============
alter publication supabase_realtime add table tasks;
