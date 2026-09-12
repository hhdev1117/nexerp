create table public.role_menu_permissions (
    role public.app_role primary key,
    allowed_menu_keys text[] not null,
    revision bigint not null default 1 check (revision > 0),
    updated_at timestamptz not null default now(),
    updated_by uuid null
);

alter table public.role_menu_permissions enable row level security;

revoke all on table public.role_menu_permissions from public, anon, authenticated;
grant select on table public.role_menu_permissions to authenticated;

-- Keep role and activation changes behind the protected administrator RPC.
revoke update (role, is_active) on table public.profiles from authenticated;

insert into public.role_menu_permissions (role, allowed_menu_keys)
values
    (
        'admin'::public.app_role,
        array[
            'approvals',
            'dashboard',
            'finance.ap',
            'finance.ar',
            'finance.journals',
            'finance.statements',
            'finance.summary',
            'inventory.items',
            'inventory.movements',
            'inventory.stock',
            'inventory.warehouses',
            'logistics.returns',
            'logistics.shipments',
            'master.accounts',
            'master.items',
            'master.partners',
            'production.bom',
            'production.quality',
            'production.schedule',
            'production.work-orders',
            'purchasing.orders',
            'purchasing.receipts',
            'purchasing.vendors',
            'reports.finance',
            'reports.inventory',
            'reports.purchasing',
            'reports.sales',
            'sales.customers',
            'sales.orders',
            'sales.quotes',
            'settings.accounts',
            'settings.audit',
            'settings.company',
            'settings.menu-permissions'
        ]::text[]
    ),
    (
        'approver'::public.app_role,
        array[
            'approvals',
            'dashboard',
            'finance.ap',
            'finance.ar',
            'finance.journals',
            'finance.statements',
            'finance.summary',
            'inventory.items',
            'inventory.movements',
            'inventory.stock',
            'inventory.warehouses',
            'logistics.returns',
            'logistics.shipments',
            'master.accounts',
            'master.items',
            'master.partners',
            'production.bom',
            'production.quality',
            'production.schedule',
            'production.work-orders',
            'purchasing.orders',
            'purchasing.receipts',
            'purchasing.vendors',
            'reports.finance',
            'reports.inventory',
            'reports.purchasing',
            'reports.sales',
            'sales.customers',
            'sales.orders',
            'sales.quotes',
            'settings.audit',
            'settings.company'
        ]::text[]
    ),
    (
        'user'::public.app_role,
        array[
            'dashboard',
            'finance.ap',
            'finance.ar',
            'finance.journals',
            'finance.statements',
            'finance.summary',
            'inventory.items',
            'inventory.movements',
            'inventory.stock',
            'inventory.warehouses',
            'logistics.returns',
            'logistics.shipments',
            'master.accounts',
            'master.items',
            'master.partners',
            'production.bom',
            'production.quality',
            'production.schedule',
            'production.work-orders',
            'purchasing.orders',
            'purchasing.receipts',
            'purchasing.vendors',
            'reports.finance',
            'reports.inventory',
            'reports.purchasing',
            'reports.sales',
            'sales.customers',
            'sales.orders',
            'sales.quotes',
            'settings.audit',
            'settings.company'
        ]::text[]
    );

create policy "Active users read their role menu permissions"
on public.role_menu_permissions
for select
to authenticated
using (
    role = (
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
using ((select private.is_admin()));

create function private.set_role_menu_permissions_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = pg_catalog.clock_timestamp();
    return new;
end;
$$;

alter function private.set_role_menu_permissions_updated_at() owner to postgres;
revoke execute on function private.set_role_menu_permissions_updated_at() from public, anon, authenticated;

create trigger set_role_menu_permissions_updated_at
before update on public.role_menu_permissions
for each row
execute function private.set_role_menu_permissions_updated_at();

create function private.protect_admin_role_menu_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.role = 'admin'::public.app_role then
        raise exception using
            errcode = '55000',
            message = 'admin_role_permissions_immutable';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

alter function private.protect_admin_role_menu_permissions() owner to postgres;
revoke execute on function private.protect_admin_role_menu_permissions() from public, anon, authenticated;

create trigger protect_admin_role_menu_permissions
before update or delete on public.role_menu_permissions
for each row
execute function private.protect_admin_role_menu_permissions();

create function public.admin_replace_role_menu_permissions(
    target_role public.app_role,
    allowed_keys text[],
    expected_revision bigint
)
returns public.role_menu_permissions
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_keys text[];
    updated_permissions public.role_menu_permissions%rowtype;
begin
    if not (select private.is_admin()) then
        raise exception using
            errcode = '42501',
            message = 'admin_required';
    end if;

    if target_role is null or expected_revision is null then
        raise exception using
            errcode = '22023',
            message = 'invalid_permission_update';
    end if;

    if target_role = 'admin'::public.app_role then
        raise exception using
            errcode = '22023',
            message = 'admin_role_permissions_locked';
    end if;

    if allowed_keys is null or exists (
        select 1
        from pg_catalog.unnest(allowed_keys) as menu_key(value)
        where menu_key.value is null or pg_catalog.btrim(menu_key.value) = ''
    ) then
        raise exception using
            errcode = '22023',
            message = 'invalid_menu_keys';
    end if;

    select coalesce(
        pg_catalog.array_agg(distinct pg_catalog.btrim(menu_key.value) order by pg_catalog.btrim(menu_key.value)),
        array[]::text[]
    )
    into normalized_keys
    from pg_catalog.unnest(allowed_keys) as menu_key(value);

    update public.role_menu_permissions as permissions
    set allowed_menu_keys = normalized_keys,
        revision = permissions.revision + 1,
        updated_by = (select auth.uid())
    where permissions.role = target_role
      and permissions.revision = expected_revision
    returning permissions.* into updated_permissions;

    if not found then
        raise exception using
            errcode = '40001',
            message = 'revision_conflict';
    end if;

    return updated_permissions;
end;
$$;

alter function public.admin_replace_role_menu_permissions(public.app_role, text[], bigint) owner to postgres;
revoke all on function public.admin_replace_role_menu_permissions(public.app_role, text[], bigint) from public, anon, authenticated;
grant execute on function public.admin_replace_role_menu_permissions(public.app_role, text[], bigint) to authenticated;

create function public.admin_update_profile(
    target_id uuid,
    new_display_name text,
    new_department text,
    new_role public.app_role,
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

    if target_id is null
       or new_display_name is null
       or new_department is null
       or new_role is null
       or new_is_active is null then
        raise exception using
            errcode = '22023',
            message = 'invalid_profile_update';
    end if;

    if target_id = caller_id and new_role <> 'admin'::public.app_role then
        raise exception using
            errcode = '22023',
            message = 'self_demotion_forbidden';
    end if;

    if target_id = caller_id and not new_is_active then
        raise exception using
            errcode = '22023',
            message = 'self_deactivation_forbidden';
    end if;

    update public.profiles as profile
    set display_name = new_display_name,
        department = new_department,
        role = new_role,
        is_active = new_is_active
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

alter function public.admin_update_profile(uuid, text, text, public.app_role, boolean) owner to postgres;
revoke all on function public.admin_update_profile(uuid, text, text, public.app_role, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, public.app_role, boolean) to authenticated;
