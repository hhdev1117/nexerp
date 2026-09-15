-- Effective-dated secondary assignments. Personal grade remains on the primary
-- employment; a secondary assignment stores only site, department and position.
create table public.hr_secondary_assignments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 employee_id uuid not null,
 employment_id uuid not null,
 site_id uuid not null,
 department text not null check(length(btrim(department)) between 1 and 150),
 position text not null check(length(btrim(position)) between 1 and 150),
 start_date date not null,
 end_date date,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 revision integer not null default 1 check(revision>0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 ended_by uuid references public.profiles(id),
 ended_at timestamptz,
 end_reason text,
 cancelled_by uuid references public.profiles(id),
 cancelled_at timestamptz,
 cancellation_reason text,
 unique(company_id,id),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id),
 foreign key(company_id,employment_id) references public.hr_employment_cycles(company_id,id),
 foreign key(company_id,site_id) references public.sites(company_id,id),
 check(end_date is null or end_date>start_date),
 check((ended_by is null and ended_at is null and end_reason is null) or
       (ended_by is not null and ended_at is not null and length(btrim(end_reason)) between 1 and 2000)),
 check((cancelled_by is null and cancelled_at is null and cancellation_reason is null) or
       (cancelled_by is not null and cancelled_at is not null and length(btrim(cancellation_reason)) between 1 and 2000))
);
alter table public.hr_secondary_assignments enable row level security;
revoke all on public.hr_secondary_assignments from public,anon,authenticated;
create index hr_secondary_assignments_period_idx
 on public.hr_secondary_assignments(company_id,employee_id,employment_id,department,start_date,end_date)
 where cancelled_at is null;

create function private.hr_secondary_status(as_of date,start_date date,end_date date,cancelled_at timestamptz) returns text
language sql immutable set search_path='' as $$
 select case when cancelled_at is not null then 'cancelled'
  when start_date>as_of then 'planned'
  when end_date is null or end_date>as_of then 'active'
  else 'ended' end;
$$;

create function private.hr_secondary_cancel_allowed(target_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.hr_module_state(target_company) in ('enabled','draining')
 and private.enterprise_granted(target_company,'hr.core','read','company')
 and private.enterprise_granted(target_company,'hr.core','update','company');
$$;

create function private.hr_authorize_secondary_cancel(target_company uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.companies where id=target_company for update;
 if not coalesce(private.hr_secondary_cancel_allowed(target_company),false) then
  raise exception 'access_denied' using errcode='42501';
 end if;
end;$$;

-- Migration 008 backfilled existing employees but could not cover employees
-- created later. Replace the create RPC so identity and first employment cycle
-- are committed atomically.
create or replace function public.hr_create_employee(target_company uuid,employee_document jsonb,change_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; field text;
begin
 perform private.hr_authorize(target_company,'create');
 if not private.enterprise_object(employee_document,array['employeeNo','name','profileId','hireDate','siteId','department','grade','position'])
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_employee' using errcode='22023';end if;
 foreach field in array array['employeeNo','name'] loop
  if jsonb_typeof(employee_document->field)<>'string' or length(btrim(employee_document->>field)) not between 1 and 100 then raise exception 'invalid_employee' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(employee_document->'profileId') not in ('null','string')
 or jsonb_typeof(employee_document->'hireDate')<>'string'
 or employee_document->>'hireDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_employee' using errcode='22023';end if;
 perform private.hr_validate_assignment(target_company,employee_document);
 if employee_document->>'profileId' is not null and not exists(
  select 1 from private.hr_link_accounts(target_company) a where a.id=(employee_document->>'profileId')::uuid
 ) then raise exception 'invalid_employee' using errcode='22023';end if;
 insert into public.hr_employees(company_id,employee_no,name,profile_id,hire_date,site_id,department,grade,position,created_by,updated_by,reason)
 values(target_company,btrim(employee_document->>'employeeNo'),btrim(employee_document->>'name'),(employee_document->>'profileId')::uuid,
 (employee_document->>'hireDate')::date,(employee_document->>'siteId')::uuid,employee_document->>'department',employee_document->>'grade',
 employee_document->>'position',auth.uid(),auth.uid(),btrim(change_reason)) returning id into result;
 insert into public.hr_employment_cycles(company_id,employee_id,sequence_no,hire_date,site_id,department,grade,position,reason,created_by,updated_by)
 values(target_company,result,1,(employee_document->>'hireDate')::date,(employee_document->>'siteId')::uuid,employee_document->>'department',
 employee_document->>'grade',employee_document->>'position',btrim(change_reason),auth.uid(),auth.uid());
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then
 raise exception 'invalid_employee' using errcode='22023';
end;$$;

create function private.hr_secondary_assignment_history_document(target_company uuid,target_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; employee_revision integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 select revision into employee_revision from public.hr_employees where company_id=target_company and id=target_employee;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'employmentId',s.employment_id,'employmentSequence',c.sequence_no,'siteId',s.site_id,
  'department',s.department,
  'grade',coalesce((select a.grade from public.hr_personnel_actions a where a.company_id=s.company_id and a.employee_id=s.employee_id
    and a.employment_id=s.employment_id and a.type='transfer' and a.cancelled_at is null
    and a.effective_date<=case when s.start_date>today then s.start_date else today end order by a.effective_date desc,a.id desc limit 1),c.grade),
  'position',s.position,'startDate',s.start_date,'endDate',s.end_date,
  'status',private.hr_secondary_status(today,s.start_date,s.end_date,s.cancelled_at),
  'reason',s.reason,'endReason',s.end_reason,'cancellationReason',s.cancellation_reason,'revision',s.revision
 ) order by c.sequence_no,s.created_at,s.id),'[]'::jsonb) into result
 from public.hr_secondary_assignments s join public.hr_employment_cycles c on c.company_id=s.company_id and c.id=s.employment_id
 where s.company_id=target_company and s.employee_id=target_employee;
 return jsonb_build_object('companyId',target_company,'employeeId',target_employee,'employeeRevision',employee_revision,
  'permissions',jsonb_build_object('create',private.enterprise_allowed(target_company,'hr.core','update','company'),
   'end',private.enterprise_allowed(target_company,'hr.core','update','company'),'cancel',private.hr_secondary_cancel_allowed(target_company)),
  'assignments',result);
end;$$;

create function public.hr_secondary_assignment_history(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.hr_authorize(target_company,'read');
 return private.hr_secondary_assignment_history_document(target_company,target_employee);
end;$$;

create function public.hr_prepare_secondary_assignment(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare employee public.hr_employees; primary_state jsonb; cycles jsonb; sites_doc jsonb; refs jsonb; mappings jsonb;
begin
 perform private.hr_authorize(target_company,'read');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 primary_state:=private.hr_employee_state(target_company,target_employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequenceNo',sequence_no,'hireDate',hire_date,'endDate',end_date,
  'siteId',site_id,'department',department,'grade',grade,'position',position) order by sequence_no),'[]'::jsonb)
 into cycles from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and cancelled_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) into sites_doc
 from public.sites where company_id=target_company and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'code',code,'name',name,'parentCode',parent_code) order by kind,code),'[]'::jsonb)
 into refs from public.hr_reference_codes where company_id=target_company and is_active and kind in ('department','position');
 select coalesce(jsonb_agg(m),'[]'::jsonb) into mappings
 from jsonb_array_elements(coalesce((select policy->'mappings' from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1),'[]'::jsonb))m
 where m->>'kind'='position' and private.enterprise_valid_now(m);
 return jsonb_build_object('companyId',target_company,'employeeId',target_employee,'employeeRevision',employee.revision,
  'primary',primary_state,'employmentCycles',cycles,'sites',sites_doc,'references',refs,'mappings',mappings,
  'permissions',jsonb_build_object('create',private.enterprise_allowed(target_company,'hr.core','update','company')));
end;$$;

create function public.hr_create_secondary_assignment(target_company uuid,target_employee uuid,expected_employee_revision integer,assignment_document jsonb,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; cycle public.hr_employment_cycles; start_on date; end_on date; primary_department text;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_employee_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if not private.enterprise_object(assignment_document,array['employmentId','siteId','department','position','startDate','endDate'])
 or jsonb_typeof(assignment_document->'employmentId')<>'string' or jsonb_typeof(assignment_document->'siteId')<>'string'
 or jsonb_typeof(assignment_document->'department')<>'string' or length(btrim(assignment_document->>'department')) not between 1 and 150
 or jsonb_typeof(assignment_document->'position')<>'string' or length(btrim(assignment_document->>'position')) not between 1 and 150
 or jsonb_typeof(assignment_document->'startDate')<>'string' or assignment_document->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(assignment_document->'endDate') not in ('null','string')
 or (assignment_document->>'endDate' is not null and assignment_document->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_secondary_assignment' using errcode='22023';end if;
 start_on:=(assignment_document->>'startDate')::date;end_on:=(assignment_document->>'endDate')::date;
 select * into cycle from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee
 and id=(assignment_document->>'employmentId')::uuid and cancelled_at is null for update;
 if not found or start_on<(now() at time zone 'Asia/Seoul')::date or start_on<cycle.hire_date
 or (cycle.end_date is not null and (start_on>=cycle.end_date or end_on>cycle.end_date)) or (end_on is not null and end_on<=start_on)
 then raise exception 'employment_bounds' using errcode='22023';end if;
 if not exists(select 1 from public.sites where company_id=target_company and id=(assignment_document->>'siteId')::uuid and is_active)
 or not exists(select 1 from public.hr_reference_codes where company_id=target_company and kind='department' and code=assignment_document->>'department' and is_active)
 or not exists(select 1 from public.hr_reference_codes where company_id=target_company and kind='position' and code=assignment_document->>'position' and is_active)
 then raise exception 'invalid_secondary_assignment' using errcode='22023';end if;
 select coalesce((select a.department from public.hr_personnel_actions a where a.company_id=target_company and a.employee_id=target_employee
  and a.employment_id=cycle.id and a.type='transfer' and a.cancelled_at is null and a.effective_date<=start_on
  order by a.effective_date desc,a.id desc limit 1),cycle.department) into primary_department;
 if primary_department=assignment_document->>'department' then raise exception 'primary_assignment_conflict' using errcode='22023';end if;
 if exists(select 1 from public.hr_secondary_assignments s where s.company_id=target_company and s.employee_id=target_employee
  and s.employment_id=cycle.id and s.department=assignment_document->>'department' and s.cancelled_at is null
  and s.start_date<coalesce(end_on,'infinity'::date) and start_on<coalesce(s.end_date,'infinity'::date))
 then raise exception 'secondary_overlap' using errcode='22023';end if;
 insert into public.hr_secondary_assignments(company_id,employee_id,employment_id,site_id,department,position,start_date,end_date,reason,created_by)
 values(target_company,target_employee,cycle.id,(assignment_document->>'siteId')::uuid,btrim(assignment_document->>'department'),
 btrim(assignment_document->>'position'),start_on,end_on,btrim(change_reason),auth.uid());
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return private.hr_secondary_assignment_history_document(target_company,target_employee);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or foreign_key_violation or check_violation then
 raise exception 'invalid_secondary_assignment' using errcode='22023';
end;$$;

create function public.hr_end_secondary_assignment(target_company uuid,target_employee uuid,target_assignment uuid,expected_employee_revision integer,expected_assignment_revision integer,new_end_date date,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; assignment public.hr_secondary_assignments; cycle public.hr_employment_cycles; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_employee_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into assignment from public.hr_secondary_assignments where company_id=target_company and employee_id=target_employee and id=target_assignment for update;
 if not found then raise exception 'invalid_secondary_assignment' using errcode='22023';end if;
 if expected_assignment_revision is distinct from assignment.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into cycle from public.hr_employment_cycles where company_id=target_company and id=assignment.employment_id;
 if assignment.cancelled_at is not null or assignment.ended_at is not null or new_end_date<today or new_end_date<=assignment.start_date
 or (cycle.end_date is not null and new_end_date>cycle.end_date) or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 then raise exception 'invalid_secondary_assignment' using errcode='22023';end if;
 update public.hr_secondary_assignments set end_date=new_end_date,ended_by=auth.uid(),ended_at=now(),end_reason=btrim(change_reason),revision=revision+1 where id=target_assignment;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return private.hr_secondary_assignment_history_document(target_company,target_employee);
end;$$;

create function public.hr_cancel_secondary_assignment(target_company uuid,target_employee uuid,target_assignment uuid,expected_employee_revision integer,expected_assignment_revision integer,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; assignment public.hr_secondary_assignments; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 perform private.hr_authorize_secondary_cancel(target_company);
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_employee_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into assignment from public.hr_secondary_assignments where company_id=target_company and employee_id=target_employee and id=target_assignment for update;
 if not found then raise exception 'invalid_secondary_assignment' using errcode='22023';end if;
 if expected_assignment_revision is distinct from assignment.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if assignment.cancelled_at is not null or assignment.ended_at is not null or assignment.start_date<=today
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 then raise exception 'planned_assignment_required' using errcode='22023';end if;
 update public.hr_secondary_assignments set cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=btrim(change_reason),revision=revision+1 where id=target_assignment;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return private.hr_secondary_assignment_history_document(target_company,target_employee);
end;$$;

create or replace function private.hr_module_pending(target_company uuid) returns integer
language sql stable security definer set search_path='' as $$
 select (select count(*) from public.hr_personnel_actions where company_id=target_company and cancelled_at is null and effective_date>(now() at time zone 'Asia/Seoul')::date)
 +(select count(*) from public.hr_employment_cycles where company_id=target_company and cancelled_at is null and sequence_no>1 and hire_date>(now() at time zone 'Asia/Seoul')::date)
 +(select count(*) from public.hr_secondary_assignments where company_id=target_company and cancelled_at is null
   and (start_date>(now() at time zone 'Asia/Seoul')::date or end_date>(now() at time zone 'Asia/Seoul')::date));
$$;

create or replace function public.hr_record_personnel_action(target_company uuid,target_employee uuid,expected_revision integer,action_document jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; cycle public.hr_employment_cycles; result uuid; effective date;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if not private.enterprise_object(action_document,array['type','effectiveDate','siteId','department','grade','position','reason'])
 or jsonb_typeof(action_document->'type')<>'string' or action_document->>'type' not in ('transfer','terminate')
 or jsonb_typeof(action_document->'reason')<>'string' or length(btrim(action_document->>'reason')) not between 1 and 2000
 or jsonb_typeof(action_document->'effectiveDate')<>'string' or action_document->>'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 then raise exception 'invalid_action' using errcode='22023';end if;
 effective:=(action_document->>'effectiveDate')::date;
 select * into cycle from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and cancelled_at is null
 and hire_date<=effective and (end_date is null or end_date>=effective) order by sequence_no desc limit 1 for update;
 if not found or effective<(now() at time zone 'Asia/Seoul')::date
 or (action_document->>'type'='transfer' and cycle.end_date is not null and effective>=cycle.end_date)
 or exists(select 1 from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and employment_id=cycle.id and cancelled_at is null and (effective_date>=effective or type='terminate'))
 then raise exception 'invalid_action' using errcode='22023';end if;
 perform private.hr_validate_assignment(target_company,action_document,action_document->>'type'<>'terminate');
 if action_document->>'type'='transfer' and exists(select 1 from public.hr_secondary_assignments s
  where s.company_id=target_company and s.employee_id=target_employee and s.employment_id=cycle.id and s.cancelled_at is null
  and s.department=action_document->>'department' and s.start_date<=effective and (s.end_date is null or s.end_date>effective))
 then raise exception 'primary_assignment_conflict' using errcode='22023';end if;
 insert into public.hr_personnel_actions(company_id,employee_id,employment_id,type,effective_date,site_id,department,grade,position,reason,created_by)
 values(target_company,target_employee,cycle.id,action_document->>'type',effective,(action_document->>'siteId')::uuid,action_document->>'department',
 action_document->>'grade',action_document->>'position',btrim(action_document->>'reason'),auth.uid()) returning id into result;
 if action_document->>'type'='terminate' then
  update public.hr_secondary_assignments set end_date=effective,ended_by=auth.uid(),ended_at=now(),
   end_reason='고용 회차 종료: '||btrim(action_document->>'reason'),revision=revision+1
  where company_id=target_company and employee_id=target_employee and employment_id=cycle.id and cancelled_at is null
   and start_date<effective and (end_date is null or end_date>effective);
  update public.hr_secondary_assignments set cancelled_by=auth.uid(),cancelled_at=now(),
   cancellation_reason='고용 회차 종료: '||btrim(action_document->>'reason'),revision=revision+1
  where company_id=target_company and employee_id=target_employee and employment_id=cycle.id and cancelled_at is null
   and start_date>=effective;
  update public.hr_employment_cycles set end_date=effective,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=cycle.id;
 end if;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then
 raise exception 'invalid_action' using errcode='22023';
end;$$;

create or replace function private.hr_reference_in_use(target_company uuid,reference_kind text,reference_code text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hr_employees e cross join lateral(select private.hr_employee_state(target_company,e.id)s)x
  where e.company_id=target_company and x.s->>'status' in ('active','planned') and x.s->>reference_kind=reference_code)
 or exists(select 1 from public.hr_employment_cycles c where c.company_id=target_company and c.cancelled_at is null
  and c.hire_date>(now() at time zone 'Asia/Seoul')::date and to_jsonb(c)->>reference_kind=reference_code)
 or exists(select 1 from public.hr_personnel_actions a where a.company_id=target_company and a.cancelled_at is null and a.type='transfer'
  and a.effective_date>(now() at time zone 'Asia/Seoul')::date and to_jsonb(a)->>reference_kind=reference_code)
 or exists(select 1 from public.hr_secondary_assignments s where s.company_id=target_company and s.cancelled_at is null
  and (s.end_date is null or s.end_date>(now() at time zone 'Asia/Seoul')::date)
  and ((reference_kind='department' and s.department=reference_code) or (reference_kind='position' and s.position=reference_code)))
 or (reference_kind='department' and exists(select 1 from public.hr_reference_codes r where r.company_id=target_company
  and r.kind='department' and r.is_active and r.parent_code=reference_code));
$$;

alter function private.hr_secondary_status(date,date,date,timestamptz) owner to postgres;
alter function private.hr_secondary_cancel_allowed(uuid) owner to postgres;
alter function private.hr_authorize_secondary_cancel(uuid) owner to postgres;
alter function private.hr_secondary_assignment_history_document(uuid,uuid) owner to postgres;
alter function public.hr_create_employee(uuid,jsonb,text) owner to postgres;
alter function public.hr_secondary_assignment_history(uuid,uuid) owner to postgres;
alter function public.hr_prepare_secondary_assignment(uuid,uuid) owner to postgres;
alter function public.hr_create_secondary_assignment(uuid,uuid,integer,jsonb,text) owner to postgres;
alter function public.hr_end_secondary_assignment(uuid,uuid,uuid,integer,integer,date,text) owner to postgres;
alter function public.hr_cancel_secondary_assignment(uuid,uuid,uuid,integer,integer,text) owner to postgres;
alter function private.hr_module_pending(uuid) owner to postgres;
alter function private.hr_reference_in_use(uuid,text,text) owner to postgres;
alter function public.hr_record_personnel_action(uuid,uuid,integer,jsonb) owner to postgres;

revoke all on function private.hr_secondary_status(date,date,date,timestamptz),private.hr_secondary_cancel_allowed(uuid),
 private.hr_authorize_secondary_cancel(uuid),private.hr_secondary_assignment_history_document(uuid,uuid) from public,anon,authenticated;
revoke all on function public.hr_secondary_assignment_history(uuid,uuid),public.hr_prepare_secondary_assignment(uuid,uuid),
 public.hr_create_secondary_assignment(uuid,uuid,integer,jsonb,text),public.hr_end_secondary_assignment(uuid,uuid,uuid,integer,integer,date,text),
 public.hr_cancel_secondary_assignment(uuid,uuid,uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.hr_secondary_assignment_history(uuid,uuid),public.hr_prepare_secondary_assignment(uuid,uuid),
 public.hr_create_secondary_assignment(uuid,uuid,integer,jsonb,text),public.hr_end_secondary_assignment(uuid,uuid,uuid,integer,integer,date,text),
 public.hr_cancel_secondary_assignment(uuid,uuid,uuid,integer,integer,text) to authenticated;
