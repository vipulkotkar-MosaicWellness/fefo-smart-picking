-- FEFO Smart Picking — shared pickers list
-- Run this in Supabase → SQL Editor (project kytktvvcbgslwokywmds), AFTER
-- schema.sql and schema_step3_complete.sql have already been run.
--
-- Fixes: pickers added via Admin only existed in that browser's local
-- storage, so nobody else ever saw them. This makes the picker list a real
-- shared table like `tasks`, with Realtime so it updates live everywhere.

create table if not exists pickers (
  name       text primary key,
  created_at timestamptz not null default now()
);

-- Seed with the same three names the app currently shows by default —
-- on conflict do nothing, so re-running this is always safe.
insert into pickers (name) values ('Ravi'), ('Sunil'), ('Amit')
  on conflict (name) do nothing;

alter table pickers enable row level security;

create policy "read pickers" on pickers for select to authenticated using (true);

-- Only Admin/Super Admin can add, rename, or remove pickers — matches who
-- can reach the Pickers card in the app's Admin screen.
create policy "admin manage pickers" on pickers for all to authenticated
  using (current_role_name() in ('admin', 'super_admin'))
  with check (current_role_name() in ('admin', 'super_admin'));

alter publication supabase_realtime add table pickers;
