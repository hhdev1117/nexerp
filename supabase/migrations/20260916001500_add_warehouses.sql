-- Site-scoped warehouse master. Stock movements and receipts will reference a warehouse, so the
-- ledger lives here rather than inside the inventory screens. Active MFA-verified users read,
-- only administrators write, and rows deactivate instead of deleting.
--
-- Requires 20260915001200_add_audit_logs.sql, which defines private.record_audit().

create type public.warehouse_type as enum ('raw_material', 'finished_good', 'packaging', 'general');
revoke all on type public.warehouse_type from public;
grant usage on type public.warehouse_type to authenticated;

-- company_id is kept alongside site_id so the table follows the company-scoping convention every
-- business table shares. A trigger keeps the two columns consistent.
create table public.warehouses (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    site_id uuid not null references public.sites (id) on delete restrict,
    code text not null,
    name text not null,
    warehouse_type public.warehouse_type not null default 'general',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint warehouses_company_code_key unique (company_id, code),
    constraint warehouses_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint warehouses_name_not_blank check (btrim(name) <> '')
);

create index warehouses_company_id_idx on public.warehouses (company_id);
create index warehouses_site_id_idx on public.warehouses (site_id);

alter table public.warehouses enable row level security;

revoke all on table public.warehouses from public, anon, authenticated;
grant select, insert, update on table public.warehouses to authenticated;

create policy "Active users read warehouses"
on public.warehouses
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert warehouses"
on public.warehouses
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update warehouses"
on public.warehouses
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create trigger set_warehouses_audit_columns
before insert or update on public.warehouses
for each row
execute function private.set_master_audit_columns();

-- A warehouse belongs to a site of its own company, and an active warehouse needs an active site.
create function private.enforce_warehouse_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    site_company uuid;
    site_active boolean;
begin
    select company_id, is_active into site_company, site_active
    from public.sites
    where id = new.site_id;

    if site_company is null then
        raise exception using errcode = '22023', message = 'site_not_found';
    end if;

    if site_company <> new.company_id then
        raise exception using errcode = '22023', message = 'site_company_mismatch';
    end if;

    if new.is_active and not site_active then
        raise exception using errcode = '22023', message = 'site_inactive';
    end if;

    return new;
end;
$$;

alter function private.enforce_warehouse_site() owner to postgres;
revoke execute on function private.enforce_warehouse_site() from public, anon, authenticated;

create trigger enforce_warehouse_site
before insert or update on public.warehouses
for each row
execute function private.enforce_warehouse_site();

-- Deactivating a site deactivates the warehouses that operate inside it. Company deactivation
-- already cascades to sites, so it reaches warehouses through this trigger.
create function private.deactivate_site_warehouses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.is_active and not new.is_active then
        update public.warehouses
        set is_active = false
        where site_id = new.id
          and is_active;
    end if;

    return new;
end;
$$;

alter function private.deactivate_site_warehouses() owner to postgres;
revoke execute on function private.deactivate_site_warehouses() from public, anon, authenticated;

create trigger deactivate_site_warehouses
after update of is_active on public.sites
for each row
execute function private.deactivate_site_warehouses();

create trigger record_warehouses_audit
after insert or update or delete on public.warehouses
for each row
execute function private.record_audit();
