-- FEFO Smart Picking — Phase B step 3, COMPLETE (run this ONE file)
-- Run in Supabase → SQL Editor, AFTER schema.sql has already been run.
-- This replaces schema_auth_tasks.sql + schema_super_admin.sql — run only
-- this file, not those two separately.
--
-- What this sets up:
--   - Real logins (Supabase Auth) with roles: super_admin, admin, planner,
--     supervisor, picker, pending.
--   - super_admin  — exactly you, the first person who ever signs up. Can
--                    nominate new Admins by email, and do anything.
--   - admin        — nominated by a super_admin (pre-authorized by email
--                    before they even sign up). Can assign Supervisor/Picker
--                    to others, but CANNOT create more Admins.
--   - Picking tasks stored as one JSONB row per task in a shared `tasks`
--     table with Realtime, so every logged-in user's queue updates live.

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
  role         text not null default 'pending'
               check (role in ('pending','super_admin','admin','planner','supervisor','picker')),
  created_at   timestamptz not null default now()
);

-- ============ admin_invites: pre-authorize an email before they sign up ============
create table if not exists admin_invites (
  email        text primary key,           -- stored lowercase
  display_name text not null,
  invited_by   uuid references profiles (id),
  created_at   timestamptz not null default now()
);

-- Helper: the calling user's own role, used inside RLS policies below.
-- Schema-qualified + search_path pinned: functions fired from an auth.users
-- trigger don't reliably inherit `public` on their search_path, so an
-- unqualified `profiles` reference can fail to resolve there even though it
-- works fine when called from the app.
create or replace function current_role_name() returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public, auth;

-- Bootstrap trigger: checks admin_invites first; else the very first person
-- to ever sign up becomes super_admin; everyone else starts 'pending'.
create or replace function handle_new_user() returns trigger as $$
declare
  is_first boolean;
  invite   public.admin_invites;
begin
  select * into invite from public.admin_invites where email = lower(new.email);

  if invite.email is not null then
    insert into public.profiles (id, email, display_name, role)
    values (new.id, new.email, invite.display_name, 'admin');
    delete from public.admin_invites where email = lower(new.email);
    return new;
  end if;

  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when is_first then 'super_admin' else 'pending' end
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, auth;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;
create policy "read all profiles" on profiles for select to authenticated using (true);

-- Tiered role assignment: super_admin can set anyone's role to anything;
-- admin can only touch pending/supervisor/picker rows, and only set them to
-- supervisor or picker — never admin/super_admin.
create policy "tiered role assignment" on profiles for update to authenticated
  using (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('pending', 'supervisor', 'picker'))
  )
  with check (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('supervisor', 'picker'))
  );

alter table admin_invites enable row level security;
create policy "super admin manages invites" on admin_invites for all to authenticated
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

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
  with check (current_role_name() in ('planner', 'admin', 'super_admin'));
create policy "assigned roles update tasks" on tasks for update to authenticated
  using (current_role_name() in ('planner', 'supervisor', 'admin', 'super_admin', 'picker'))
  with check (current_role_name() in ('planner', 'supervisor', 'admin', 'super_admin', 'picker'));

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
