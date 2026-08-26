-- FEFO Smart Picking — add the "inventory_planner" role
-- Run this in Supabase → SQL Editor. Safe to run any number of times.
--
-- Same screen access as 'planner' (Demand Planner, Picking Supervisor,
-- Inventory, Stock Holds, Reports, Gate Pass Adherence — see
-- src/lib/navigation.ts), plus the manual inventory-upload fallback that
-- 'planner' doesn't have. Intended for the handful of people who need to
-- upload/sync stock and clear pending picklists without full Admin.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('pending','super_admin','admin','planner','picker','inventory_planner'));

drop policy if exists "tiered role assignment" on profiles;
create policy "tiered role assignment" on profiles for update to authenticated
  using (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('pending', 'planner', 'inventory_planner', 'picker'))
  )
  with check (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('planner', 'inventory_planner', 'picker'))
  );

drop policy if exists "planner admin create tasks" on tasks;
create policy "planner admin create tasks" on tasks for insert to authenticated
  with check (current_role_name() in ('planner', 'inventory_planner', 'admin', 'super_admin'));

drop policy if exists "assigned roles update tasks" on tasks;
create policy "assigned roles update tasks" on tasks for update to authenticated
  using (current_role_name() in ('planner', 'inventory_planner', 'admin', 'super_admin', 'picker'))
  with check (current_role_name() in ('planner', 'inventory_planner', 'admin', 'super_admin', 'picker'));

-- ============ stock/sync_state write access for the manual upload fallback ============
-- These never existed as tracked policies before this migration — only
-- SELECT was granted (see schema.sql), so INSERT/DELETE/UPDATE were
-- previously denied to every client role; only the Apps Script's service-role
-- key could write. This is what actually lets Admin/Super Admin/Inventory
-- Planner use "Upload inventory (fallback)" in the app.
drop policy if exists "elevated roles upload stock" on stock;
create policy "elevated roles upload stock" on stock for insert to authenticated
  with check (current_role_name() in ('inventory_planner', 'admin', 'super_admin'));

drop policy if exists "elevated roles clear stock" on stock;
create policy "elevated roles clear stock" on stock for delete to authenticated
  using (current_role_name() in ('inventory_planner', 'admin', 'super_admin'));

drop policy if exists "elevated roles update sync_state" on sync_state;
create policy "elevated roles update sync_state" on sync_state for update to authenticated
  using (current_role_name() in ('inventory_planner', 'admin', 'super_admin'))
  with check (current_role_name() in ('inventory_planner', 'admin', 'super_admin'));
