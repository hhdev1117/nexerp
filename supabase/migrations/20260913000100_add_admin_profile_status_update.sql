create function public.admin_update_profile_status(
    target_id uuid,
    new_is_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := (select auth.uid());
    updated_profile public.profiles%rowtype;
begin
    if not (select private.is_admin()) then
        raise exception using
            errcode = '42501',
            message = 'admin_required';
    end if;

    if target_id is null or new_is_active is null then
        raise exception using
            errcode = '22023',
            message = 'invalid_profile_update';
    end if;

    if target_id = caller_id and not new_is_active then
        raise exception using
            errcode = '22023',
            message = 'self_deactivation_forbidden';
    end if;

    update public.profiles as profile
    set is_active = new_is_active
    where profile.id = target_id
    returning profile.* into updated_profile;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'profile_not_found';
    end if;

    return updated_profile;
end;
$$;

alter function public.admin_update_profile_status(uuid, boolean) owner to postgres;
revoke all on function public.admin_update_profile_status(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_profile_status(uuid, boolean) to authenticated;
