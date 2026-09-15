begin;

create table private.user_provisioning_nonces (
    login_id text primary key check (login_id ~ '^[a-z0-9]{4,20}$'),
    nonce text not null check (length(nonce) between 16 and 200),
    expires_at timestamptz not null
);

alter table private.user_provisioning_nonces enable row level security;
revoke all on table private.user_provisioning_nonces from public, anon, authenticated;

create or replace function public.prepare_user_provisioning(target_login_id text, provisioning_nonce text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if target_login_id !~ '^[a-z0-9]{4,20}$' or length(provisioning_nonce) not between 16 and 200 then
        raise exception using errcode = '22023', message = 'invalid_provisioning_request';
    end if;

    insert into private.user_provisioning_nonces (login_id, nonce, expires_at)
    values (target_login_id, provisioning_nonce, pg_catalog.now() + interval '5 minutes')
    on conflict (login_id) do update
    set nonce = excluded.nonce, expires_at = excluded.expires_at;

    return true;
end;
$$;

alter function public.prepare_user_provisioning(text, text) owner to postgres;
revoke all on function public.prepare_user_provisioning(text, text) from public, anon, authenticated;
grant execute on function public.prepare_user_provisioning(text, text) to service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := pg_catalog.lower(coalesce(new.email, ''));
    normalized_login_id text := pg_catalog.split_part(normalized_email, '@', 1);
    expected_email text := normalized_login_id || '@nexerp.internal';
    provisioning_nonce text := coalesce(new.raw_user_meta_data ->> 'provisioning_nonce', '');
    consumed_login_id text;
begin
    if normalized_login_id !~ '^[a-z0-9]{4,20}$' or normalized_email <> expected_email then
        raise exception using errcode = '22023', message = 'invalid_login_id';
    end if;

    delete from private.user_provisioning_nonces
    where login_id = normalized_login_id
      and nonce = provisioning_nonce
      and expires_at > pg_catalog.now()
    returning login_id into consumed_login_id;

    if not found then
        raise exception using errcode = '42501', message = 'provisioning_required';
    end if;

    insert into public.profiles (id, email, login_id, role)
    values (new.id, expected_email, normalized_login_id, 'user'::public.app_role);
    return new;
end;
$$;

alter function private.handle_new_user() owner to postgres;
revoke all on function private.handle_new_user() from public, anon, authenticated;

commit;
