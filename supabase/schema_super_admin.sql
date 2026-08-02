-- FEFO Smart Picking — Super Admin tier + admin nomination
-- Run this AFTER schema_auth_tasks.sql, in Supabase → SQL Editor.
--
-- Model:
--   super_admin  — exactly you (the first person who ever signed up, promoted
--                  below). Can nominate new Admins by email, and do anything.
--   admin        — nominated by a super_admin. Can assign Supervisor/Picker
--                  to others, but CANNOT create more Admins or Super Admins.
--   supervisor / picker / pending — unchanged.

-- ============ widen the role check to include super_admin ============
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('pending','super_admin','admin','supervisor','picker'));

-- One-time: promote today's sole/first admin to super_admin.
-- (If you already have more than one admin, only the earliest-created one is promoted —
--  check the result and adjust manually if needed.)
update profiles set role = 'super_admin'
where id = (select id from profiles where role = 'admin' order by created_at asc limit 1);

-- ============ admin_invites: pre-authorize an email before they sign up ============
create table if not exists admin_invites (
  email        text primary key,           -- stored lowercase
  display_name text not null,
  invited_by   uuid references profiles (id),
  created_at   timestamptz not null default now()
);
alter table admin_invites enable row level security;
create policy "super admin manages invites" on admin_invites for all to authenticated
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- ============ bootstrap trigger: check invites, else first-ever = super_admin ============
create or replace function handle_new_user() returns trigger as $$
declare
  is_first boolean;
  invite   admin_invites;
begin
  select * into invite from admin_invites where email = lower(new.email);

  if invite.email is not null then
    insert into profiles (id, email, display_name, role)
    values (new.id, new.email, invite.display_name, 'admin');
    delete from admin_invites where email = lower(new.email);
    return new;
  end if;

  select count(*) = 0 into is_first from profiles;
  insert into profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when is_first then 'super_admin' else 'pending' end
  );
  return new;
end;
$$ language plpgsql security definer;

-- ============ role-assignment RLS: tiered ============
-- super_admin: can set anyone's role to anything.
-- admin: can only touch rows currently pending/supervisor/picker, and can
--        only set them to supervisor or picker — never admin/super_admin.
drop policy if exists "admin updates roles" on profiles;
create policy "tiered role assignment" on profiles for update to authenticated
  using (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('pending', 'supervisor', 'picker'))
  )
  with check (
    current_role_name() = 'super_admin'
    or (current_role_name() = 'admin' and role in ('supervisor', 'picker'))
  );
