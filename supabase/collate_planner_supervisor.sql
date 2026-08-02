-- FEFO Smart Picking — collate Planner + Supervisor into one role
-- Run this in Supabase → SQL Editor. Safe to run any number of times.
--
-- 'planner' now covers both creating picklists AND receiving/assigning them
-- to Pickers. 'supervisor' is retired as a role.

-- Move any existing Supervisor accounts onto Planner before dropping the value.
update profiles set role = 'planner' where role = 'supervisor';

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('pending','super_admin','admin','planner','picker'));

drop policy if exists "tiered role assignment" on profiles;
create policy "tiered role assignment" on profiles for update to authenticated
  using (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('pending', 'planner', 'picker'))
  )
  with check (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('planner', 'picker'))
  );

drop policy if exists "assigned roles update tasks" on tasks;
create policy "assigned roles update tasks" on tasks for update to authenticated
  using (current_role_name() in ('planner', 'admin', 'super_admin', 'picker'))
  with check (current_role_name() in ('planner', 'admin', 'super_admin', 'picker'));
