-- Company-scoped item master. Sales, purchasing, inventory and production all reference items
-- from here; the inventory screens read and select rather than owning a second ledger. Active
-- MFA-verified users read, only administrators write, and rows deactivate instead of deleting.
--
-- Requires 20260915001200_add_audit_logs.sql, which defines private.record_audit().

create type public.item_type as enum ('raw_material', 'semi_finished', 'finished_good', 'consumable', 'service');
revoke all on type public.item_type from public;
grant usage on type public.item_type to authenticated;

create table public.items (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    code text not null,
    name text not null,
    item_type public.item_type not null default 'raw_material',
    unit text not null default 'EA',
    safety_stock numeric(18, 3) not null default 0,
    standard_price numeric(18, 0) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint items_company_code_key unique (company_id, code),
    constraint items_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint items_name_not_blank check (btrim(name) <> ''),
    constraint items_unit_format check (unit ~ '^[A-Z]{1,8}$'),
    constraint items_safety_stock_range check (safety_stock >= 0),
    constraint items_standard_price_range check (standard_price >= 0)
);

create index items_company_id_idx on public.items (company_id);

alter table public.items enable row level security;

revoke all on table public.items from public, anon, authenticated;
grant select, insert, update on table public.items to authenticated;

create policy "Active users read items"
on public.items
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert items"
on public.items
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update items"
on public.items
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create trigger set_items_audit_columns
before insert or update on public.items
for each row
execute function private.set_master_audit_columns();

-- An active item can only belong to an active company.
create function private.enforce_item_company_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.is_active and not exists (
        select 1
        from public.companies
        where id = new.company_id
          and is_active
    ) then
        raise exception using
            errcode = '22023',
            message = 'company_inactive';
    end if;

    return new;
end;
$$;

alter function private.enforce_item_company_active() owner to postgres;
revoke execute on function private.enforce_item_company_active() from public, anon, authenticated;

create trigger enforce_item_company_active
before insert or update on public.items
for each row
execute function private.enforce_item_company_active();

create trigger record_items_audit
after insert or update or delete on public.items
for each row
execute function private.record_audit();

-- Fold the legacy inventory item menu into the single master ledger key, preserving every role
-- that already held either grant. Mirrors the customer/vendor consolidation in 20260914000200.
create temporary table item_permission_grants (
    role public.app_role not null,
    menu_key text not null,
    primary key (role, menu_key)
) on commit drop;

insert into item_permission_grants (role, menu_key)
select distinct permissions.role, 'master.items'
from public.role_menu_permissions as permissions
cross join lateral pg_catalog.unnest(permissions.allowed_menu_keys) as allowed(menu_key)
where allowed.menu_key in ('inventory.items', 'master.items')
on conflict do nothing;

alter table public.role_menu_permissions disable trigger protect_admin_role_menu_permissions;

update public.role_menu_permissions as permissions
set allowed_menu_keys = pg_catalog.array_remove(
        case
            when grants.role is not null
                 and not coalesce('master.items' = any (permissions.allowed_menu_keys), false)
                then pg_catalog.array_append(permissions.allowed_menu_keys, 'master.items')
            else permissions.allowed_menu_keys
        end,
        'inventory.items'
    ),
    revision = permissions.revision + 1
from item_permission_grants as grants
where grants.role = permissions.role;

alter table public.role_menu_permissions enable trigger protect_admin_role_menu_permissions;
