begin;

create or replace function public.bootstrap_first_admin(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    affected_rows integer;
begin
    -- Stable application lock key reserved for the NEXERP first-administrator bootstrap.
    perform pg_catalog.pg_advisory_xact_lock(5645584552504144);

    if exists (
        select 1
        from public.profiles
        where role = 'admin'::public.app_role
          and is_active = true
    ) then
        raise exception using errcode = 'P0001', message = 'active_admin_exists';
    end if;

    update public.profiles
    set role = 'admin'::public.app_role
    where id = target_user_id
      and is_active = true;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
        raise exception using errcode = 'P0001', message = 'profile_promotion_failed';
    end if;

    return target_user_id;
end;
$$;

alter function public.bootstrap_first_admin(uuid) owner to postgres;
revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

commit;
