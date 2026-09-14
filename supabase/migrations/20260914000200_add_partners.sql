-- Company-scoped partner master. Active MFA-verified users may read records;
-- only administrators may insert or update them. Records are deactivated rather
-- than deleted.

create table public.partners (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    code text not null,
    name text not null,
    business_number text null,
    is_customer boolean not null default false,
    is_vendor boolean not null default false,
    representative text not null default '',
    email text not null default '',
    phone text not null default '',
    address text not null default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint partners_company_code_key unique (company_id, code),
    constraint partners_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint partners_name_not_blank check (btrim(name) <> ''),
    constraint partners_role_required check (is_customer or is_vendor),
    constraint partners_business_number_format check (business_number is null or business_number ~ '^[0-9]{10}$')
);

create unique index partners_company_business_number_key
on public.partners (company_id, business_number)
where business_number is not null;

create index partners_company_id_idx on public.partners (company_id);

alter table public.partners enable row level security;

revoke all on table public.partners from public, anon, authenticated;
grant select, insert, update on table public.partners to authenticated;

create policy "Active users read partners"
on public.partners
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert partners"
on public.partners
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update partners"
on public.partners
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create trigger set_partners_audit_columns
before insert or update on public.partners
for each row
execute function private.set_master_audit_columns();

-- An active partner can only belong to an active company.
create function private.enforce_partner_company_active()
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

alter function private.enforce_partner_company_active() owner to postgres;
revoke execute on function private.enforce_partner_company_active() from public, anon, authenticated;

create trigger enforce_partner_company_active
before insert or update on public.partners
for each row
execute function private.enforce_partner_company_active();

-- Preserve every role that had any partner-like menu grant before removing the
-- two legacy keys. The temporary normalized set makes the migration order clear
-- while the application continues to store permissions as text arrays.
create temporary table partner_permission_grants (
    role public.app_role not null,
    menu_key text not null,
    primary key (role, menu_key)
) on commit drop;

insert into partner_permission_grants (role, menu_key)
select distinct permissions.role, 'master.partners'
from public.role_menu_permissions as permissions
cross join lateral pg_catalog.unnest(permissions.allowed_menu_keys) as allowed(menu_key)
where allowed.menu_key in ('sales.customers', 'purchasing.vendors', 'master.partners')
on conflict do nothing;

alter table public.role_menu_permissions disable trigger protect_admin_role_menu_permissions;

update public.role_menu_permissions as permissions
set allowed_menu_keys = pg_catalog.array_remove(
        pg_catalog.array_remove(
            case
                when grants.role is not null
                     and not coalesce('master.partners' = any (permissions.allowed_menu_keys), false)
                    then pg_catalog.array_append(permissions.allowed_menu_keys, 'master.partners')
                else permissions.allowed_menu_keys
            end,
            'sales.customers'
        ),
        'purchasing.vendors'
    ),
    revision = permissions.revision + 1
from partner_permission_grants as grants
where grants.role = permissions.role;

alter table public.role_menu_permissions enable trigger protect_admin_role_menu_permissions;
