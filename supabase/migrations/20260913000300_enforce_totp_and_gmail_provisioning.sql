create or replace function private.is_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;

alter function private.is_aal2() owner to postgres;
revoke all on function private.is_aal2() from public, anon, authenticated;
grant execute on function private.is_aal2() to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select private.is_aal2())
       and exists (
            select 1
            from public.profiles
            where id = (select auth.uid())
              and role = 'admin'::public.app_role
              and is_active
       );
$$;

alter function private.is_admin() owner to postgres;
revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "Active users read their role menu permissions" on public.role_menu_permissions;
drop policy if exists "Active admins read all role menu permissions" on public.role_menu_permissions;

create policy "Active users read their role menu permissions"
on public.role_menu_permissions
for select
to authenticated
using (
    (select private.is_aal2())
    and role = (
        select profile.role
        from public.profiles as profile
        where profile.id = (select auth.uid())
          and profile.is_active
    )
);

create policy "Active admins read all role menu permissions"
on public.role_menu_permissions
for select
to authenticated
using (
    (select private.is_aal2())
    and (select private.is_admin())
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := pg_catalog.lower(coalesce(new.email, ''));
begin
    if normalized_email !~ '^[^[:space:]@]+@gmail[.]com$' then
        raise exception using
            errcode = '22023',
            message = 'gmail_required';
    end if;

    if not coalesce(new.raw_app_meta_data @> '{"nexerp_provisioned": true}'::jsonb, false) then
        raise exception using
            errcode = '42501',
            message = 'provisioning_required';
    end if;

    insert into public.profiles (id, email, role)
    values (new.id, normalized_email, 'user'::public.app_role);
    return new;
end;
$$;

alter function private.handle_new_user() owner to postgres;
revoke all on function private.handle_new_user() from public, anon, authenticated;
