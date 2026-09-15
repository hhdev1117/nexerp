-- Company module controls gate HR operations, never employment-derived membership.
create table public.hr_module_settings (
 company_id uuid primary key references public.companies(id),
 state text not null check(state in ('enabled','draining','read_only','disabled')),
 menu_visible boolean not null, revision integer not null check(revision>0),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table public.hr_module_settings_audit (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 module_key text not null check(module_key='hr.core'), before_document jsonb not null, after_document jsonb not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.hr_module_settings enable row level security;
alter table public.hr_module_settings_audit enable row level security;
revoke all on public.hr_module_settings,public.hr_module_settings_audit from public,anon,authenticated;

create function private.hr_module_state(target_company uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select state from public.hr_module_settings where company_id=target_company),'enabled');
$$;
create function private.hr_module_allows(target_company uuid,operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select case private.hr_module_state(target_company)
 when 'enabled' then operation in ('menu','read','create','update','cancel')
 when 'draining' then operation in ('menu','read','cancel')
 when 'read_only' then operation in ('menu','read') else false end;
$$;
create function private.hr_module_pending(target_company uuid) returns integer
language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.hr_personnel_actions where company_id=target_company
 and cancelled_at is null and effective_date>(now() at time zone 'Asia/Seoul')::date;
$$;

create function public.hr_module_settings(target_company uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; core jsonb;
begin
 if not coalesce(private.is_admin() and private.is_aal2(),false) then raise exception 'access_denied' using errcode='42501';end if;
 perform 1 from public.companies where id=target_company for update;
 if not found then raise exception 'invalid_company' using errcode='22023';end if;
 select jsonb_build_object('key','hr.core','label','인사 기본','available',true,
 'state',coalesce(s.state,'enabled'),'menuVisible',coalesce(s.menu_visible,true),'revision',coalesce(s.revision,0),
 'pendingActions',private.hr_module_pending(target_company),'dependents','[]'::jsonb) into core
 from (select 1) dummy left join public.hr_module_settings s on s.company_id=target_company;
 select jsonb_build_array(core)||jsonb_agg(jsonb_build_object('key',key,'label',label,'available',false,
 'state','disabled','menuVisible',false,'revision',0,'pendingActions',0,'dependents','[]'::jsonb) order by ord) into result
 from (values (1,'hr.dashboard','인사 현황'),(2,'hr.recruitment','채용'),(3,'hr.onboarding','입사·퇴사 업무'),
 (4,'hr.contracts','계약'),(5,'hr.schedule','근무제·근무표'),(6,'hr.attendance','근태'),(7,'hr.leave','휴가'),
 (8,'hr.payroll','급여'),(9,'hr.statutory','보험·세무·퇴직정산'),(10,'hr.performance','평가'),(11,'hr.compensation','보상'),
 (12,'hr.learning','교육·자격'),(13,'hr.benefits','복리후생'),(14,'hr.travel','출장·경비'),(15,'hr.assets','지급품'),
 (16,'hr.documents','문서·증명서'),(17,'hr.reports','인사 보고서'),(18,'hr.self','내 인사정보')) registry(ord,key,label);
 return jsonb_build_object('companyId',target_company,'modules',result);
end;$$;

create function public.hr_save_module_settings(target_company uuid,module_key text,expected_revision integer,desired_state text,menu_visible boolean,change_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare previous jsonb; result jsonb;
begin
 if not coalesce(private.is_admin() and private.is_aal2(),false) then raise exception 'access_denied' using errcode='42501';end if;
 if module_key is distinct from 'hr.core' then raise exception 'module_unavailable' using errcode='22023';end if;
 if desired_state is null or desired_state not in ('enabled','draining','read_only','disabled') or menu_visible is null
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_module_settings' using errcode='22023';end if;
 -- Lock the same company row as every HR authorization, before any employee lock.
 perform 1 from public.companies where id=target_company for update;
 if not found then raise exception 'invalid_company' using errcode='22023';end if;
 previous:=public.hr_module_settings(target_company)->'modules'->0;
 if expected_revision is distinct from (previous->>'revision')::integer then raise exception 'revision_conflict' using errcode='40001';end if;
 if desired_state in ('read_only','disabled') and private.hr_module_pending(target_company)>0 then raise exception 'module_pending_actions' using errcode='22023';end if;
 insert into public.hr_module_settings(company_id,state,menu_visible,revision,updated_by)
 values(target_company,desired_state,menu_visible,expected_revision+1,auth.uid())
 on conflict(company_id) do update set state=excluded.state,menu_visible=excluded.menu_visible,
 revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
 result:=public.hr_module_settings(target_company);
 insert into public.hr_module_settings_audit(company_id,module_key,before_document,after_document,reason,created_by)
 values(target_company,module_key,previous,result->'modules'->0,btrim(change_reason),auth.uid());
 return result;
end;$$;

-- Preserve the original grant evaluator for draining cancellation only.
create or replace function private.enterprise_granted(target_company uuid,resource_key text,action_key text,scope_filter text default null,row_site uuid default null) returns boolean
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
create or replace function private.enterprise_allowed(target_company uuid,resource_key text,action_key text,scope_filter text default null,row_site uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select (resource_key<>'hr.core' or private.hr_module_allows(target_company,action_key))
 and private.enterprise_granted(target_company,resource_key,action_key,scope_filter,row_site);
$$;
create function private.hr_authorize_cancel(target_company uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.companies where id=target_company for update;
 if not coalesce(private.hr_module_allows(target_company,'cancel')
 and private.enterprise_granted(target_company,'hr.core','read','company')
 and private.enterprise_granted(target_company,'hr.core','update','company'),false)
 then raise exception 'access_denied' using errcode='42501';end if;
end;$$;
create or replace function private.hr_authorize(target_company uuid,action_key text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.companies where id=target_company for update;
 if not coalesce(private.enterprise_allowed(target_company,'hr.core','read','company'),false)
 or not coalesce(private.enterprise_allowed(target_company,'hr.core',action_key,'company'),false)
 then raise exception 'access_denied' using errcode='42501';end if;
end;$$;
create or replace function public.hr_cancel_personnel_action(target_company uuid,target_employee uuid,target_action uuid,expected_revision integer,change_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; action public.hr_personnel_actions;
begin
 perform private.hr_authorize_cancel(target_company);
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
create or replace function public.hr_directory(target_company uuid,search_text text default '',page_number integer default 1) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
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
 return jsonb_build_object('moduleState',private.hr_module_state(target_company),'accounts',accounts,'employees',employees,'total',total,'page',page_number,'pageSize',25,'sites',sites,'permissions',jsonb_build_object('cancel',private.hr_module_allows(target_company,'cancel') and private.enterprise_granted(target_company,'hr.core','update','company'),'create',private.enterprise_allowed(target_company,'hr.core','create','company'),'update',private.enterprise_allowed(target_company,'hr.core','update','company')));
end; $$;
create or replace function public.enterprise_access_context(target_company uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare catalog jsonb; selected uuid; rev integer; menus jsonb; global_active boolean; legacy boolean; company_actions jsonb; site_actions jsonb;
begin
 if not coalesce(private.is_active_user(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 select exists(select 1 from public.enterprise_access_publications) into global_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) into catalog from public.companies c where (not global_active or private.is_admin() or private.enterprise_member(c.id,(select policy from public.enterprise_access_publications where company_id=c.id order by revision desc limit 1)) is not null);
 if target_company is not null then
  if exists(select 1 from jsonb_array_elements(catalog) c where c->>'id'=target_company::text) then selected:=target_company; end if;
 else selected := (catalog->0->>'id')::uuid;
 end if;
 perform 1 from public.companies where id=selected for update;
 select revision into rev from public.enterprise_access_publications where company_id=selected order by revision desc limit 1;
 legacy := not global_active or (selected is not null and rev is null and private.is_admin());
 select coalesce(jsonb_agg(resource order by resource),'[]'::jsonb) into menus from unnest(private.enterprise_resources()) resource where not legacy and selected is not null
 and exists(select 1 from unnest(array['self','assigned','organization','organization_tree','site','company']) s where private.enterprise_allowed(selected,resource,'menu',s))
 and exists(select 1 from unnest(array['self','assigned','organization','organization_tree','site','company']) s where private.enterprise_allowed(selected,resource,'read',s));
 select coalesce(jsonb_agg(a order by a),'[]'::jsonb) into company_actions from unnest(array['read','create','update']) a where not legacy and private.enterprise_allowed(selected,'settings.company',a);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'actions',(select coalesce(jsonb_agg(a order by a),'[]'::jsonb) from unnest(array['read','update']) a where private.enterprise_allowed(selected,'settings.company',a,null,s.id))) order by s.id),'[]'::jsonb) into site_actions from public.sites s where not legacy and s.company_id=selected and private.enterprise_allowed(selected,'settings.company','read',null,s.id);
 return jsonb_build_object('companyActions',company_actions,'siteActions',site_actions,'mode',case when legacy then 'legacy' else 'active' end,'companyId',selected,'companies',catalog,'menuKeys',menus,'hiddenMenuKeys',case when menus ? 'hr.core' and exists(select 1 from public.hr_module_settings where company_id=selected and not menu_visible) then '["hr.core"]'::jsonb else '[]'::jsonb end,'revision',coalesce(rev,0));
end; $$;
create or replace function private.enterprise_resources() returns text[]
language sql immutable set search_path = '' as $$
 select array['dashboard','approvals','sales.quotes','sales.orders','sales.customers','purchasing.orders','purchasing.receipts','purchasing.vendors','inventory.stock','inventory.movements','inventory.items','inventory.warehouses','logistics.shipments','logistics.returns','production.work-orders','production.bom','production.schedule','production.quality','finance.summary','finance.ar','finance.ap','finance.journals','finance.statements','reports.sales','reports.purchasing','reports.inventory','reports.finance','master.items','master.partners','master.accounts','settings.company','settings.accounts','settings.menu-permissions','settings.enterprise-access','settings.infrastructure-usage','settings.audit','hr.core','settings.hr-modules'];
$$;
-- Read RPCs use a fresh statement snapshot after waiting on the company lock.
alter function public.hr_reference_catalog(uuid) volatile;
alter function public.hr_employee_corrections(uuid,uuid) volatile;
alter function private.hr_module_state(uuid) owner to postgres;
revoke all on function private.hr_module_state(uuid) from public,anon,authenticated;
alter function private.hr_module_allows(uuid,text) owner to postgres;
revoke all on function private.hr_module_allows(uuid,text) from public,anon,authenticated;
alter function private.hr_module_pending(uuid) owner to postgres;
revoke all on function private.hr_module_pending(uuid) from public,anon,authenticated;
alter function private.enterprise_granted(uuid,text,text,text,uuid) owner to postgres;
revoke all on function private.enterprise_granted(uuid,text,text,text,uuid) from public,anon,authenticated;
alter function private.hr_authorize_cancel(uuid) owner to postgres;
revoke all on function private.hr_authorize_cancel(uuid) from public,anon,authenticated;
alter function public.hr_module_settings(uuid) owner to postgres;
revoke all on function public.hr_module_settings(uuid) from public,anon,authenticated;
alter function public.hr_save_module_settings(uuid,text,integer,text,boolean,text) owner to postgres;
revoke all on function public.hr_save_module_settings(uuid,text,integer,text,boolean,text) from public,anon,authenticated;
grant execute on function public.hr_module_settings(uuid),public.hr_save_module_settings(uuid,text,integer,text,boolean,text) to authenticated;
