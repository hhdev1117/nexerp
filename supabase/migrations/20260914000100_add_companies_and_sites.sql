-- Multi-company, multi-site master data. Every future business table references companies
-- (and sites where relevant). Reads require an active, MFA-verified user; writes require an
-- administrator. Rows are deactivated rather than deleted.

create or replace function private.is_active_user()
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
              and is_active
       );
$$;

alter function private.is_active_user() owner to postgres;
revoke all on function private.is_active_user() from public, anon, authenticated;
grant execute on function private.is_active_user() to authenticated;

create type public.site_type as enum ('head_office', 'factory', 'warehouse', 'branch', 'other');
revoke all on type public.site_type from public;
grant usage on type public.site_type to authenticated;

create table public.companies (
    id uuid primary key default gen_random_uuid(),
    code text not null,
    name text not null,
    business_number text null,
    representative text not null default '',
    address text not null default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint companies_code_key unique (code),
    constraint companies_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint companies_name_not_blank check (btrim(name) <> ''),
    constraint companies_business_number_format check (business_number is null or business_number ~ '^[0-9]{10}$')
);

create unique index companies_business_number_key on public.companies (business_number) where business_number is not null;

create table public.sites (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    code text not null,
    name text not null,
    site_type public.site_type not null default 'other',
    address text not null default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint sites_company_code_key unique (company_id, code),
    constraint sites_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint sites_name_not_blank check (btrim(name) <> '')
);

create index sites_company_id_idx on public.sites (company_id);

alter table public.companies enable row level security;
alter table public.sites enable row level security;

revoke all on table public.companies from public, anon, authenticated;
revoke all on table public.sites from public, anon, authenticated;
grant select, insert, update on table public.companies to authenticated;
grant select, insert, update on table public.sites to authenticated;

create policy "Active users read companies"
on public.companies
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert companies"
on public.companies
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update companies"
on public.companies
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "Active users read sites"
on public.sites
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert sites"
on public.sites
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update sites"
on public.sites
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- Audit columns always describe the caller; client-supplied values are ignored.
create function private.set_master_audit_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.created_at = pg_catalog.clock_timestamp();
        new.created_by = (select auth.uid());
    else
        new.created_at = old.created_at;
        new.created_by = old.created_by;
    end if;

    new.updated_at = pg_catalog.clock_timestamp();
    new.updated_by = (select auth.uid());
    return new;
end;
$$;

alter function private.set_master_audit_columns() owner to postgres;
revoke execute on function private.set_master_audit_columns() from public, anon, authenticated;

create trigger set_companies_audit_columns
before insert or update on public.companies
for each row
execute function private.set_master_audit_columns();

create trigger set_sites_audit_columns
before insert or update on public.sites
for each row
execute function private.set_master_audit_columns();

-- An active site can only belong to an active company.
create function private.enforce_site_company_active()
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

alter function private.enforce_site_company_active() owner to postgres;
revoke execute on function private.enforce_site_company_active() from public, anon, authenticated;

create trigger enforce_site_company_active
before insert or update on public.sites
for each row
execute function private.enforce_site_company_active();

-- Deactivating a company deactivates every site that still operates under it.
create function private.deactivate_company_sites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.is_active and not new.is_active then
        update public.sites
        set is_active = false
        where company_id = new.id
          and is_active;
    end if;

    return new;
end;
$$;

alter function private.deactivate_company_sites() owner to postgres;
revoke execute on function private.deactivate_company_sites() from public, anon, authenticated;

create trigger deactivate_company_sites
after update of is_active on public.companies
for each row
execute function private.deactivate_company_sites();
