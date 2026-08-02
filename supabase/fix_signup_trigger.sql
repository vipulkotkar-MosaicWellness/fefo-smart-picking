-- FEFO Smart Picking — fix "Database error saving new user" on sign-up
-- Run this in Supabase → SQL Editor. Safe to run any number of times.
--
-- Root cause: handle_new_user() referenced `profiles` / `admin_invites`
-- without a schema prefix. Triggers fired from an auth.users insert don't
-- reliably inherit the `public` schema on their search_path, so Postgres
-- couldn't find the tables and the whole signup transaction failed with a
-- generic "Database error saving new user".
--
-- Fix: schema-qualify every reference and pin the function's search_path
-- explicitly, so it always resolves regardless of caller context.

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

-- current_role_name() is used inside RLS policies on every request — same
-- fix, for the same reason, so role checks never silently misbehave either.
create or replace function current_role_name() returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public, auth;
