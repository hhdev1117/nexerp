create type public.app_role as enum ('admin', 'approver', 'user');

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text not null default '',
    department text not null default '',
    role public.app_role not null default 'user',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, department) on table public.profiles to authenticated;

revoke all on type public.app_role from public;
grant usage on type public.app_role to authenticated;

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'::public.app_role
          and is_active
    );
$$;

alter function private.is_admin() owner to postgres;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create policy "Active users read their own profile"
on public.profiles
for select
to authenticated
using (
    (select auth.uid()) = id
    and is_active
);

create policy "Active admins read all profiles"
on public.profiles
for select
to authenticated
using ((select private.is_admin()));

create policy "Active users update their profile"
on public.profiles
for update
to authenticated
using (
    (select auth.uid()) = id
    and is_active
)
with check (
    (select auth.uid()) = id
    and is_active
);

create function private.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = pg_catalog.clock_timestamp();
    return new;
end;
$$;

alter function private.set_profile_updated_at() owner to postgres;
revoke execute on function private.set_profile_updated_at() from public, anon, authenticated;

create trigger set_profile_updated_at
before update on public.profiles
for each row
execute function private.set_profile_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'user'::public.app_role);
    return new;
end;
$$;

alter function private.handle_new_user() owner to postgres;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger create_profile_after_signup
after insert on auth.users
for each row
execute function private.handle_new_user();
