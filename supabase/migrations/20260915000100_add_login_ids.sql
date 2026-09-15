begin;

alter table public.profiles add column login_id text;
alter table public.profiles add constraint profiles_login_id_format check (login_id ~ '^[a-z0-9]{4,20}$');
create unique index profiles_login_id_key on public.profiles (login_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_login_id text := coalesce(new.raw_app_meta_data ->> 'login_id', '');
    expected_email text := normalized_login_id || '@nexerp.internal';
begin
    if normalized_login_id !~ '^[a-z0-9]{4,20}$' then
        raise exception using errcode = '22023', message = 'invalid_login_id';
    end if;

    if pg_catalog.lower(coalesce(new.email, '')) <> expected_email then
        raise exception using errcode = '22023', message = 'login_identity_mismatch';
    end if;

    if not coalesce(new.raw_app_meta_data @> '{"nexerp_provisioned": true}'::jsonb, false) then
        raise exception using errcode = '42501', message = 'provisioning_required';
    end if;

    insert into public.profiles (id, email, login_id, role)
    values (new.id, expected_email, normalized_login_id, 'user'::public.app_role);
    return new;
end;
$$;

alter function private.handle_new_user() owner to postgres;
revoke all on function private.handle_new_user() from public, anon, authenticated;

alter table public.profiles alter column login_id set not null;

commit;
