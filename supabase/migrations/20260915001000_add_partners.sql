-- Unified customer/vendor master data. Records are deactivated, never deleted.
create table public.partners (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    code text not null,
    name text not null,
    business_number text,
    is_customer boolean not null default false,
    is_vendor boolean not null default false,
    representative text not null default '',
    contact_name text not null default '',
    phone text not null default '',
    email text not null default '',
    address text not null default '',
    payment_terms_days integer not null default 30,
    credit_limit numeric(18,0) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid,
    updated_by uuid,
    constraint partners_company_code_key unique (company_id, code),
    constraint partners_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    constraint partners_name_not_blank check (btrim(name) <> ''),
    constraint partners_role_required check (is_customer or is_vendor),
    constraint partners_business_number_format check (business_number is null or business_number ~ '^[0-9]{10}$'),
    constraint partners_payment_terms_nonnegative check (payment_terms_days >= 0),
    constraint partners_credit_limit_nonnegative check (credit_limit >= 0)
);
create unique index partners_company_business_number_key on public.partners(company_id,business_number) where business_number is not null;
create index partners_company_id_idx on public.partners(company_id,code);

alter table public.partners enable row level security;
revoke all on table public.partners from public,anon,authenticated;
grant select, insert, update on table public.partners to authenticated;
create policy "Active users read partners" on public.partners for select to authenticated using ((select private.is_active_user()));
create policy "Active admins insert partners" on public.partners for insert to authenticated with check ((select private.is_admin()));
create policy "Active admins update partners" on public.partners for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger set_partners_audit_columns before insert or update on public.partners for each row execute function private.set_master_audit_columns();

create function private.enforce_partner_company_active() returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
    if new.is_active and not exists(select 1 from public.companies where id=new.company_id and is_active) then
        raise exception using errcode='22023', message = 'company_inactive';
    end if;
    return new;
end;$$;
alter function private.enforce_partner_company_active() owner to postgres;
revoke all on function private.enforce_partner_company_active() from public,anon,authenticated;
create trigger enforce_partner_company_active before insert or update on public.partners for each row execute function private.enforce_partner_company_active();

-- Preserve any legacy role-menu access while removing duplicate navigation keys.
alter table public.role_menu_permissions disable trigger protect_admin_role_menu_permissions;
update public.role_menu_permissions
set allowed_menu_keys=array_remove(array_remove(
    case when allowed_menu_keys && array['sales.customers','purchasing.vendors','master.partners']
         and not allowed_menu_keys @> array['master.partners'] then array_append(allowed_menu_keys,'master.partners') else allowed_menu_keys end,
    'sales.customers'),'purchasing.vendors'),
    revision=revision+1,updated_at=now()
where allowed_menu_keys && array['sales.customers','purchasing.vendors'];
alter table public.role_menu_permissions enable trigger protect_admin_role_menu_permissions;

create function private.partner_migrate_permissions(items jsonb) returns jsonb
language sql immutable set search_path='' as $$
    select coalesce(jsonb_agg(item order by item::text),'[]'::jsonb) from (
        select distinct case when value->>'resource' in ('sales.customers','purchasing.vendors')
            then jsonb_set(value,'{resource}','"master.partners"'::jsonb) else value end item
        from jsonb_array_elements(coalesce(items,'[]'::jsonb))
    ) migrated;
$$;
create function private.partner_migrate_policy(document jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:=document;
begin
    result:=jsonb_set(result,'{levels}',coalesce((select jsonb_agg(jsonb_set(value,'{permissions}',private.partner_migrate_permissions(value->'permissions'))) from jsonb_array_elements(coalesce(result->'levels','[]'::jsonb))),'[]'::jsonb));
    result:=jsonb_set(result,'{roles}',coalesce((select jsonb_agg(jsonb_set(value,'{permissions}',private.partner_migrate_permissions(value->'permissions'))) from jsonb_array_elements(coalesce(result->'roles','[]'::jsonb))),'[]'::jsonb));
    result:=jsonb_set(result,'{overrides}',private.partner_migrate_permissions(result->'overrides'));
    return result;
end;$$;
update public.enterprise_access_policies set policy=private.partner_migrate_policy(policy);
update public.enterprise_access_policy_audit set policy=private.partner_migrate_policy(policy),previous_policy=case when previous_policy is null then null else private.partner_migrate_policy(previous_policy) end;
update public.enterprise_access_publications set policy=private.partner_migrate_policy(policy);

create or replace function private.enterprise_resources() returns text[]
language sql immutable set search_path = '' as $$
 select array['dashboard','approvals','sales.quotes','sales.orders','purchasing.orders','purchasing.receipts','inventory.stock','inventory.movements','inventory.items','inventory.warehouses','logistics.shipments','logistics.returns','production.work-orders','production.bom','production.schedule','production.quality','finance.summary','finance.ar','finance.ap','finance.journals','finance.statements','reports.sales','reports.purchasing','reports.inventory','reports.finance','master.items','master.partners','master.accounts','settings.company','settings.accounts','settings.menu-permissions','settings.enterprise-access','settings.infrastructure-usage','settings.audit','hr.core','settings.hr-modules'];
$$;

alter function private.partner_migrate_permissions(jsonb) owner to postgres;
alter function private.partner_migrate_policy(jsonb) owner to postgres;
alter function private.enterprise_resources() owner to postgres;
revoke all on function private.partner_migrate_permissions(jsonb),private.partner_migrate_policy(jsonb),private.enterprise_resources() from public,anon,authenticated;
