-- Draft configuration only: legacy ERP authorization does not read these tables.
create table public.enterprise_access_policies (
    company_id uuid primary key references public.companies(id),
    policy jsonb not null,
    revision integer not null check (revision > 0),
    updated_by uuid not null references public.profiles(id),
    updated_at timestamptz not null default now()
);
create table public.enterprise_access_policy_audit (
    company_id uuid not null references public.companies(id),
    revision integer not null check (revision > 0),
    previous_policy jsonb,
    policy jsonb not null,
    reason text not null check (length(btrim(reason)) between 1 and 2000),
    actor_id uuid not null references public.profiles(id),
    created_at timestamptz not null default now(),
    primary key (company_id, revision)
);
alter table public.enterprise_access_policies enable row level security;
alter table public.enterprise_access_policy_audit enable row level security;
revoke all on public.enterprise_access_policies, public.enterprise_access_policy_audit from public, anon, authenticated;
grant select on public.enterprise_access_policies, public.enterprise_access_policy_audit to authenticated;
create policy "AAL2 admins read enterprise drafts" on public.enterprise_access_policies for select to authenticated using ((select private.is_admin()));
create policy "AAL2 admins read enterprise audit" on public.enterprise_access_policy_audit for select to authenticated using ((select private.is_admin()));

-- Reject unknown keys and missing keys as well as wrong primitive/container types.
create function private.enterprise_object(value jsonb, keys text[]) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(value) = 'object' and value ?& keys and (value - keys) = '{}'::jsonb, false);
$$;
create function private.enterprise_interval(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
 if jsonb_typeof(value->'from') not in ('null','string') or jsonb_typeof(value->'to') not in ('null','string') then return false; end if;
 if (value->>'from' is not null and value->>'from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') or (value->>'to' is not null and value->>'to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then return false; end if;
 if value->>'from' is not null then perform (value->>'from')::date; end if;
 if value->>'to' is not null then perform (value->>'to')::date; end if;
 return (value->>'from' is null or value->>'to' is null or (value->>'from')::date < (value->>'to')::date);
exception when others then return false;
end;
$$;
-- Registered staged resources; new menu resources require an explicit migration.
create function private.enterprise_resources() returns text[]
language sql immutable set search_path = '' as $$
 select array['dashboard','approvals','sales.quotes','sales.orders','sales.customers','purchasing.orders','purchasing.receipts','purchasing.vendors','inventory.stock','inventory.movements','inventory.items','inventory.warehouses','logistics.shipments','logistics.returns','production.work-orders','production.bom','production.schedule','production.quality','finance.summary','finance.ar','finance.ap','finance.journals','finance.statements','reports.sales','reports.purchasing','reports.inventory','reports.finance','master.items','master.partners','master.accounts','settings.company','settings.accounts','settings.menu-permissions','settings.enterprise-access','settings.infrastructure-usage','settings.audit'];
$$;
revoke all on function private.enterprise_resources() from public, anon, authenticated;
create function private.enterprise_permission(value jsonb) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(value->'resource') = 'string' and value->>'resource' = any(private.enterprise_resources())
 and jsonb_typeof(value->'action') = 'string' and value->>'action' in ('menu','read','create','update','cancel','submit','approve','export','close','reopen','manage')
 and jsonb_typeof(value->'scope') = 'string' and value->>'scope' in ('self','assigned','organization','organization_tree','site','company'), false);
$$;

create function public.enterprise_save_access_policy(target_company uuid, policy_document jsonb, expected_revision integer, change_reason text)
returns table(policy jsonb, revision integer)
language plpgsql security definer set search_path = '' as $$
declare
 item jsonb; permission_item jsonb; actor jsonb; section text; current_policy jsonb; current_revision integer; next_revision integer;
begin
 if not coalesce(private.is_admin(), false) then raise exception 'access_denied' using errcode = '42501'; end if;
 -- Lock company even on first insert, preventing concurrent revision-zero creation.
 perform 1 from public.companies where id = target_company and is_active for update;
 if not found or expected_revision is null or expected_revision < 0 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then
   raise exception 'invalid_policy' using errcode = '22023';
 end if;
 select p.policy, p.revision into current_policy, current_revision from public.enterprise_access_policies p where p.company_id = target_company;
 if coalesce(current_revision,0) <> expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
 if not private.enterprise_object(policy_document, array['levels','mappings','members','roles','overrides']) or octet_length(policy_document::text) > 2000000 then raise exception 'invalid_policy' using errcode = '22023'; end if;
 foreach section in array array['levels','mappings','members','roles','overrides'] loop
   if jsonb_typeof(policy_document->section) <> 'array' then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if jsonb_array_length(policy_document->'levels') <> 5 then raise exception 'invalid_policy' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(policy_document->'levels') loop
   if not private.enterprise_object(item,array['id','name','permissions']) or jsonb_typeof(item->'id') <> 'number' or item->>'id' not in ('1','2','3','4','5') or jsonb_typeof(item->'name') <> 'string' or length(btrim(item->>'name')) not between 1 and 100 then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(policy_document->'levels')) <> 5 then raise exception 'invalid_policy' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(policy_document->'members') loop
   if not private.enterprise_object(item,array['id','name','grade','position','level','organizationId','siteId','active','from','to'])
      or jsonb_typeof(item->'id') <> 'string' or jsonb_typeof(item->'name') <> 'string' or length(btrim(item->>'name')) not between 1 and 100
      or jsonb_typeof(item->'active') <> 'boolean' or not private.enterprise_interval(item)
      or not (item->'level' = 'null'::jsonb or (jsonb_typeof(item->'level') = 'number' and item->>'level' in ('1','2','3','4','5')))
      then raise exception 'invalid_policy' using errcode = '22023'; end if;
   foreach section in array array['grade','position','organizationId','siteId'] loop
     if jsonb_typeof(item->section) not in ('string','null') or length(item->>section) > 150 then raise exception 'invalid_policy' using errcode = '22023'; end if;
   end loop;
   if not exists(select 1 from public.profiles p where p.id = (item->>'id')::uuid and (item->>'active' = 'false' or p.is_active)) then raise exception 'invalid_policy' using errcode = '22023'; end if;
   if nullif(item->>'siteId','') is not null and not exists(select 1 from public.sites site where site.id = (item->>'siteId')::uuid and site.company_id = target_company and site.is_active) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if (select count(*) <> count(distinct (value->>'id')::uuid) from jsonb_array_elements(policy_document->'members')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(policy_document->'mappings') loop
   if not private.enterprise_object(item,array['kind','code','level','from','to']) or jsonb_typeof(item->'kind') <> 'string' or item->>'kind' not in ('grade','position') or jsonb_typeof(item->'code') <> 'string' or length(btrim(item->>'code')) not between 1 and 100 or jsonb_typeof(item->'level') <> 'number' or item->>'level' not in ('1','2','3','4','5') or not private.enterprise_interval(item) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(policy_document->'mappings') with ordinality a(v,n) join jsonb_array_elements(policy_document->'mappings') with ordinality b(v,n) on a.n < b.n and a.v->>'kind' = b.v->>'kind' and a.v->>'code' = b.v->>'code' where daterange((a.v->>'from')::date,(a.v->>'to')::date,'[)') && daterange((b.v->>'from')::date,(b.v->>'to')::date,'[)')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(policy_document->'roles') loop
   if not private.enterprise_object(item,array['id','name','permissions','members']) or jsonb_typeof(item->'id') <> 'string' or length(btrim(item->>'id')) not between 1 and 100 or jsonb_typeof(item->'name') <> 'string' or length(btrim(item->>'name')) not between 1 and 100 or jsonb_typeof(item->'members') <> 'array' then raise exception 'invalid_policy' using errcode = '22023'; end if;
   for actor in select value from jsonb_array_elements(item->'members') loop
     if jsonb_typeof(actor) <> 'string' or not exists(select 1 from jsonb_array_elements(policy_document->'members') m where m->'id' = actor) then raise exception 'invalid_policy' using errcode = '22023'; end if;
   end loop;
   if (select count(*) <> count(distinct value) from jsonb_array_elements(item->'members')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(policy_document->'roles')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements((policy_document->'levels') || (policy_document->'roles')) loop
   if jsonb_typeof(item->'permissions') <> 'array' then raise exception 'invalid_policy' using errcode = '22023'; end if;
   for permission_item in select value from jsonb_array_elements(item->'permissions') loop
     if not private.enterprise_object(permission_item,array['resource','action','scope']) or not private.enterprise_permission(permission_item) then raise exception 'invalid_policy' using errcode = '22023'; end if;
   end loop;
   if (select count(*) <> count(distinct value) from jsonb_array_elements(item->'permissions')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(policy_document->'overrides') loop
   if not private.enterprise_object(item,array['actorId','resource','action','scope','effect','from','to']) or not private.enterprise_permission(item) or jsonb_typeof(item->'effect') <> 'string' or item->>'effect' not in ('allow','deny') or not private.enterprise_interval(item) or not exists(select 1 from jsonb_array_elements(policy_document->'members') m where m->'id' = item->'actorId') then raise exception 'invalid_policy' using errcode = '22023'; end if;
 end loop;
 if (select count(*) <> count(distinct value) from jsonb_array_elements(policy_document->'overrides')) then raise exception 'invalid_policy' using errcode = '22023'; end if;
 next_revision := coalesce(current_revision,0) + 1;
 insert into public.enterprise_access_policies as p(company_id,policy,revision,updated_by) values(target_company,policy_document,next_revision,auth.uid())
 on conflict(company_id) do update set policy = excluded.policy, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now();
 insert into public.enterprise_access_policy_audit(company_id,revision,previous_policy,policy,reason,actor_id) values(target_company,next_revision,current_policy,policy_document,btrim(change_reason),auth.uid());
 return query select policy_document,next_revision;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_policy' using errcode = '22023';
end;
$$;
alter function public.enterprise_save_access_policy(uuid,jsonb,integer,text) owner to postgres;
revoke all on function public.enterprise_save_access_policy(uuid,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.enterprise_save_access_policy(uuid,jsonb,integer,text) to authenticated;
revoke all on function private.enterprise_object(jsonb,text[]), private.enterprise_interval(jsonb), private.enterprise_permission(jsonb) from public, anon, authenticated;
