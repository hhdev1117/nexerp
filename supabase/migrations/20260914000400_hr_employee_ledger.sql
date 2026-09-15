-- HR data is RPC-only: technical recovery permissions never imply employee access.
alter table public.sites add constraint sites_company_id_id_key unique(company_id,id);
create table public.hr_employees (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 employee_no text not null check(length(btrim(employee_no)) between 1 and 100),
 name text not null check(length(btrim(name)) between 1 and 100),
 profile_id uuid references public.profiles(id), hire_date date not null, site_id uuid,
 department text not null, grade text not null, position text not null,
 revision integer not null default 1 check(revision>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 unique(company_id,id), unique(company_id,employee_no), unique(company_id,profile_id),
 foreign key(company_id,site_id) references public.sites(company_id,id)
);
create table public.hr_personnel_actions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
 type text not null check(type in ('transfer','terminate')), effective_date date not null, site_id uuid,
 department text not null, grade text not null, position text not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 cancelled_at timestamptz, cancelled_by uuid references public.profiles(id), cancellation_reason text,
 unique(company_id,employee_id,effective_date),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id),
 foreign key(company_id,site_id) references public.sites(company_id,id),
 check((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
 (cancelled_at is not null and cancelled_by is not null and length(btrim(cancellation_reason)) between 1 and 2000))
);
alter table public.hr_employees enable row level security;
alter table public.hr_personnel_actions enable row level security;
revoke all on public.hr_employees,public.hr_personnel_actions from public,anon,authenticated;

create function private.hr_employee_state(target_company uuid,target_employee uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('siteId',case when t.id is not null then t.site_id else e.site_id end,
 'department',coalesce(t.department,e.department),
 'grade',coalesce(t.grade,e.grade),
 'position',coalesce(t.position,e.position),
 'status',case when e.hire_date>(now() at time zone 'Asia/Seoul')::date then 'planned' when a.type='terminate' then 'terminated' else 'active' end)
 from public.hr_employees e left join lateral (
 select * from public.hr_personnel_actions a where a.company_id=e.company_id and a.employee_id=e.id and a.cancelled_at is null
 and a.effective_date <= (now() at time zone 'Asia/Seoul')::date order by a.effective_date desc limit 1
 ) a on true left join lateral (
 select * from public.hr_personnel_actions t where t.company_id=e.company_id and t.employee_id=e.id and t.cancelled_at is null
 and t.type='transfer' and t.effective_date <= (now() at time zone 'Asia/Seoul')::date order by t.effective_date desc limit 1
 ) t on true where e.company_id=target_company and e.id=target_employee;
$$;
create function private.enterprise_member(target_company uuid,document jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare member jsonb; employee uuid; state jsonb;
begin
 member:=private.enterprise_member(document);
 if member is null then return null; end if;
 select id into employee from public.hr_employees where company_id=target_company and profile_id=auth.uid();
 if employee is null then return member; end if;
 state:=private.hr_employee_state(target_company,employee);
 if state->>'status'<>'active' then return null; end if;
 return member || jsonb_build_object('grade',state->'grade','position',state->'position','siteId',state->'siteId','organizationId',state->'department');
end; $$;
create function private.hr_authorize(target_company uuid,action_key text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.enterprise_allowed(target_company,'hr.core','read','company'),false)
 or not coalesce(private.enterprise_allowed(target_company,'hr.core',action_key,'company'),false)
 then raise exception 'access_denied' using errcode='42501'; end if;
end; $$;
create function private.hr_validate_assignment(target_company uuid,document jsonb,active_required boolean default true) returns void
language plpgsql stable security definer set search_path='' as $$
declare field text;
begin
 foreach field in array array['department','grade','position'] loop
 if jsonb_typeof(document->field)<>'string' or length(document->>field)>150 then raise exception 'invalid_employee' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(document->'siteId') not in ('null','string') then raise exception 'invalid_employee' using errcode='22023'; end if;
 if document->>'siteId' is not null and not exists(select 1 from public.sites where company_id=target_company and id=(document->>'siteId')::uuid and (not active_required or is_active)) then raise exception 'invalid_employee' using errcode='22023'; end if;
end; $$;
-- Only published company members are account-link candidates, including future
-- memberships. This catalog is never a global profile directory.
create function private.hr_link_accounts(target_company uuid) returns table(id uuid,name text)
language sql stable security definer set search_path='' as $$
 select p.id,m->>'name' from jsonb_array_elements(
 (select policy->'members' from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1)
 ) m join public.profiles p on p.id=(m->>'id')::uuid
 where m->>'active'='true' and p.is_active
 and not exists(select 1 from public.hr_employees e where e.company_id=target_company and e.profile_id=p.id);
$$;
revoke all on function private.hr_link_accounts(uuid) from public,anon,authenticated;
alter function private.hr_link_accounts(uuid) owner to postgres;
create function public.hr_create_employee(target_company uuid,employee_document jsonb,change_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; field text;
begin
 perform private.hr_authorize(target_company,'create');
 if not private.enterprise_object(employee_document,array['employeeNo','name','profileId','hireDate','siteId','department','grade','position'])
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_employee' using errcode='22023'; end if;
 foreach field in array array['employeeNo','name'] loop
 if jsonb_typeof(employee_document->field)<>'string' or length(btrim(employee_document->>field)) not between 1 and 100 then raise exception 'invalid_employee' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(employee_document->'profileId') not in ('null','string') or jsonb_typeof(employee_document->'hireDate')<>'string' or employee_document->>'hireDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_employee' using errcode='22023'; end if;
 perform private.hr_validate_assignment(target_company,employee_document);
 if employee_document->>'profileId' is not null and not exists(
 select 1 from private.hr_link_accounts(target_company) a where a.id=(employee_document->>'profileId')::uuid
 ) then raise exception 'invalid_employee' using errcode='22023'; end if;
 insert into public.hr_employees(company_id,employee_no,name,profile_id,hire_date,site_id,department,grade,position,created_by,updated_by,reason)
 values(target_company,btrim(employee_document->>'employeeNo'),btrim(employee_document->>'name'),(employee_document->>'profileId')::uuid,(employee_document->>'hireDate')::date,(employee_document->>'siteId')::uuid,employee_document->>'department',employee_document->>'grade',employee_document->>'position',auth.uid(),auth.uid(),btrim(change_reason)) returning id into result;
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then raise exception 'invalid_employee' using errcode='22023';
end; $$;
create function public.hr_record_personnel_action(target_company uuid,target_employee uuid,expected_revision integer,action_document jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; result uuid; effective date;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023'; end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 if not private.enterprise_object(action_document,array['type','effectiveDate','siteId','department','grade','position','reason'])
 or jsonb_typeof(action_document->'type')<>'string' or action_document->>'type' not in ('transfer','terminate')
 or jsonb_typeof(action_document->'reason')<>'string' or length(btrim(action_document->>'reason')) not between 1 and 2000
 or jsonb_typeof(action_document->'effectiveDate')<>'string' or action_document->>'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 then raise exception 'invalid_action' using errcode='22023'; end if;
 effective:=(action_document->>'effectiveDate')::date;
 if effective<employee.hire_date or effective<(now() at time zone 'Asia/Seoul')::date
 or exists(select 1 from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and cancelled_at is null and (effective_date>=effective or type='terminate'))
 then raise exception 'invalid_action' using errcode='22023'; end if;
 perform private.hr_validate_assignment(target_company,action_document,action_document->>'type'<>'terminate');
 insert into public.hr_personnel_actions(company_id,employee_id,type,effective_date,site_id,department,grade,position,reason,created_by)
 values(target_company,target_employee,action_document->>'type',effective,(action_document->>'siteId')::uuid,action_document->>'department',action_document->>'grade',action_document->>'position',btrim(action_document->>'reason'),auth.uid()) returning id into result;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then raise exception 'invalid_action' using errcode='22023';
end; $$;
create function public.hr_cancel_personnel_action(target_company uuid,target_employee uuid,target_action uuid,expected_revision integer,change_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; action public.hr_personnel_actions;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023'; end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 select * into action from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and id=target_action;
 if not found or action.cancelled_at is not null or action.effective_date<=(now() at time zone 'Asia/Seoul')::date
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 or exists(select 1 from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and cancelled_at is null and effective_date>action.effective_date)
 then raise exception 'invalid_action' using errcode='22023'; end if;
 update public.hr_personnel_actions set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(change_reason) where id=target_action;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
end; $$;
create function public.hr_directory(target_company uuid,search_text text default '',page_number integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare employees jsonb; total bigint; sites jsonb; accounts jsonb := '[]'::jsonb;
begin
 perform private.hr_authorize(target_company,'read');
 if search_text is null or length(search_text)>100 or page_number is null or page_number<1 or page_number>1000000 then raise exception 'invalid_query' using errcode='22023'; end if;
 select count(*) into total from public.hr_employees where company_id=target_company and (strpos(lower(name),lower(btrim(search_text)))>0 or strpos(lower(employee_no),lower(btrim(search_text)))>0);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'companyId',e.company_id,'employeeNo',e.employee_no,'name',e.name,'profileId',e.profile_id,'hireDate',e.hire_date,'revision',e.revision,'actions',
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,'effectiveDate',a.effective_date,'siteId',a.site_id,'department',a.department,'grade',a.grade,'position',a.position,'reason',a.reason,'cancelled',a.cancelled_at is not null) order by a.effective_date,a.id),'[]'::jsonb) from public.hr_personnel_actions a where a.company_id=e.company_id and a.employee_id=e.id)) || private.hr_employee_state(target_company,e.id) order by e.employee_no,e.id),'[]'::jsonb) into employees
 from (select * from public.hr_employees where company_id=target_company and (strpos(lower(name),lower(btrim(search_text)))>0 or strpos(lower(employee_no),lower(btrim(search_text)))>0) order by employee_no,id limit 25 offset (page_number-1)*25) e;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) into sites from public.sites where company_id=target_company and is_active;
 if private.enterprise_allowed(target_company,'hr.core','create','company') then
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name,a.id),'[]'::jsonb) into accounts from private.hr_link_accounts(target_company) a;
 end if;
 return jsonb_build_object('accounts',accounts,'employees',employees,'total',total,'page',page_number,'pageSize',25,'sites',sites,'permissions',jsonb_build_object('create',private.enterprise_allowed(target_company,'hr.core','create','company'),'update',private.enterprise_allowed(target_company,'hr.core','update','company')));
end; $$;
revoke all on function private.hr_employee_state(uuid,uuid),private.enterprise_member(uuid,jsonb),private.hr_authorize(uuid,text),private.hr_validate_assignment(uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.hr_create_employee(uuid,jsonb,text),public.hr_record_personnel_action(uuid,uuid,integer,jsonb),public.hr_cancel_personnel_action(uuid,uuid,uuid,integer,text),public.hr_directory(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.hr_create_employee(uuid,jsonb,text),public.hr_record_personnel_action(uuid,uuid,integer,jsonb),public.hr_cancel_personnel_action(uuid,uuid,uuid,integer,text),public.hr_directory(uuid,text,integer) to authenticated;
create or replace function private.enterprise_resources() returns text[]
language sql immutable set search_path = '' as $$
 select array['dashboard','approvals','sales.quotes','sales.orders','sales.customers','purchasing.orders','purchasing.receipts','purchasing.vendors','inventory.stock','inventory.movements','inventory.items','inventory.warehouses','logistics.shipments','logistics.returns','production.work-orders','production.bom','production.schedule','production.quality','finance.summary','finance.ar','finance.ap','finance.journals','finance.statements','reports.sales','reports.purchasing','reports.inventory','reports.finance','master.items','master.partners','master.accounts','settings.company','settings.accounts','settings.menu-permissions','settings.enterprise-access','settings.infrastructure-usage','settings.audit','hr.core'];
$$;
create or replace function private.enterprise_allowed(target_company uuid,resource_key text,action_key text,scope_filter text default null,row_site uuid default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare document jsonb; member jsonb; effective_level integer; grants jsonb; overrides jsonb;
begin
 if not coalesce(private.is_active_user(),false) then return false; end if;
 if not exists(select 1 from public.companies where id=target_company and (is_active or (resource_key='settings.company' and action_key in ('menu','read','update')))) then return false; end if;
 select policy into document from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1;
 member := private.enterprise_member(target_company,document);
 if member is null then return false; end if;
 if resource_key='hr.core' and (scope_filter is distinct from 'company' or action_key not in ('menu','read','create','update')) then return false; end if;
 effective_level := (member->>'level')::integer;
 if effective_level is null then
  select (m->>'level')::integer into effective_level from jsonb_array_elements(document->'mappings') m where private.enterprise_valid_now(m) and ((m->>'kind'='position' and m->>'code'=member->>'position') or (m->>'kind'='grade' and m->>'code'=member->>'grade')) order by case when m->>'kind'='position' then 0 else 1 end limit 1;
 end if;
 select coalesce(jsonb_agg(p),'[]'::jsonb) into grants from jsonb_array_elements((document->'levels')||(document->'roles')) r cross join lateral jsonb_array_elements(r->'permissions') p where (r ? 'id' and r->>'id'=effective_level::text and not r ? 'members') or (r->'members' ? (member->>'id'));
 select coalesce(jsonb_agg(o),'[]'::jsonb) into overrides from jsonb_array_elements(document->'overrides') o where o->>'actorId'=member->>'id' and private.enterprise_valid_now(o);
 -- The first HR slice cannot filter narrower employee scopes: any dated deny
 -- for this action closes the company-wide operation instead of widening it.
 if resource_key='hr.core' and exists(select 1 from jsonb_array_elements(overrides) p where p->>'effect'='deny' and p->>'resource'=resource_key and p->>'action'=action_key) then return false; end if;
 -- A matching deny always wins, including company-wide denies against a narrower navigation grant.
 if exists(select 1 from jsonb_array_elements(overrides) p where p->>'effect'='deny' and p->>'resource'=resource_key and p->>'action'=action_key and
  (case when scope_filter is not null then (p->>'scope' in ('company',scope_filter) or (scope_filter='organization' and p->>'scope'='organization_tree')) else p->>'scope'='company' or (p->>'scope'='site' and row_site is not null and member->>'siteId'=row_site::text) end)) then return false; end if;
 return exists(select 1 from jsonb_array_elements(grants||overrides) p where coalesce(p->>'effect','allow')='allow' and p->>'resource'=resource_key and p->>'action'=action_key and
  (case when scope_filter is not null then p->>'scope'=scope_filter and (scope_filter <> 'site' or nullif(member->>'siteId','') is not null) and (scope_filter not in ('organization','organization_tree') or nullif(member->>'organizationId','') is not null) else p->>'scope'='company' or (p->>'scope'='site' and row_site is not null and member->>'siteId'=row_site::text) end));
end; $$;
create or replace function public.enterprise_access_context(target_company uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare catalog jsonb; selected uuid; rev integer; menus jsonb; global_active boolean; legacy boolean; company_actions jsonb; site_actions jsonb;
begin
 if not coalesce(private.is_active_user(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 select exists(select 1 from public.enterprise_access_publications) into global_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) into catalog from public.companies c where (not global_active or private.is_admin() or private.enterprise_member(c.id,(select policy from public.enterprise_access_publications where company_id=c.id order by revision desc limit 1)) is not null);
 if target_company is not null then
  if exists(select 1 from jsonb_array_elements(catalog) c where c->>'id'=target_company::text) then selected:=target_company; end if;
 else selected := (catalog->0->>'id')::uuid;
 end if;
 select revision into rev from public.enterprise_access_publications where company_id=selected order by revision desc limit 1;
 legacy := not global_active or (selected is not null and rev is null and private.is_admin());
 select coalesce(jsonb_agg(resource order by resource),'[]'::jsonb) into menus from unnest(private.enterprise_resources()) resource where not legacy and selected is not null
 and exists(select 1 from unnest(array['self','assigned','organization','organization_tree','site','company']) s where private.enterprise_allowed(selected,resource,'menu',s))
 and exists(select 1 from unnest(array['self','assigned','organization','organization_tree','site','company']) s where private.enterprise_allowed(selected,resource,'read',s));
 select coalesce(jsonb_agg(a order by a),'[]'::jsonb) into company_actions from unnest(array['read','create','update']) a where not legacy and private.enterprise_allowed(selected,'settings.company',a);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'actions',(select coalesce(jsonb_agg(a order by a),'[]'::jsonb) from unnest(array['read','update']) a where private.enterprise_allowed(selected,'settings.company',a,null,s.id))) order by s.id),'[]'::jsonb) into site_actions from public.sites s where not legacy and s.company_id=selected and private.enterprise_allowed(selected,'settings.company','read',null,s.id);
 return jsonb_build_object('companyActions',company_actions,'siteActions',site_actions,'mode',case when legacy then 'legacy' else 'active' end,'companyId',selected,'companies',catalog,'menuKeys',menus,'revision',coalesce(rev,0));
end; $$;

alter function private.hr_employee_state(uuid,uuid) owner to postgres;
alter function private.enterprise_member(uuid,jsonb) owner to postgres;
alter function private.hr_authorize(uuid,text) owner to postgres;
alter function private.hr_validate_assignment(uuid,jsonb,boolean) owner to postgres;
alter function public.hr_create_employee(uuid,jsonb,text) owner to postgres;
alter function public.hr_record_personnel_action(uuid,uuid,integer,jsonb) owner to postgres;
alter function public.hr_cancel_personnel_action(uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.hr_directory(uuid,text,integer) owner to postgres;
