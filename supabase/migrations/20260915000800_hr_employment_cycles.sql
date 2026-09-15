-- Employment cycles preserve rehire history while employee identity and number stay stable.
create table public.hr_employment_cycles (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
 sequence_no integer not null check(sequence_no>0), hire_date date not null, end_date date, site_id uuid,
 department text not null, grade text not null, position text not null,
 revision integer not null default 1 check(revision>0), reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 cancelled_at timestamptz, cancelled_by uuid references public.profiles(id), cancellation_reason text,
 account_changed boolean not null default false, previous_profile_id uuid references public.profiles(id),
 rehire_profile_id uuid references public.profiles(id),
 unique(company_id,employee_id,sequence_no), unique(company_id,id),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id),
 foreign key(company_id,site_id) references public.sites(company_id,id),
 check(end_date is null or end_date>hire_date),
 check((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
 (cancelled_at is not null and cancelled_by is not null and length(btrim(cancellation_reason)) between 1 and 2000)),
 check((account_changed and previous_profile_id is distinct from rehire_profile_id) or
 (not account_changed and previous_profile_id is null and rehire_profile_id is null))
);
alter table public.hr_employment_cycles enable row level security;
revoke all on public.hr_employment_cycles from public,anon,authenticated;
create index hr_employment_cycles_employee_idx on public.hr_employment_cycles(company_id,employee_id,sequence_no desc);

insert into public.hr_employment_cycles(company_id,employee_id,sequence_no,hire_date,end_date,site_id,department,grade,position,reason,created_by,created_at,updated_by,updated_at)
select e.company_id,e.id,1,e.hire_date,
 (select min(a.effective_date) from public.hr_personnel_actions a where a.company_id=e.company_id and a.employee_id=e.id and a.type='terminate' and a.cancelled_at is null),
 e.site_id,e.department,e.grade,e.position,e.reason,e.created_by,e.created_at,e.updated_by,e.updated_at
from public.hr_employees e;

alter table public.hr_personnel_actions add column employment_id uuid;
update public.hr_personnel_actions a set employment_id=c.id from public.hr_employment_cycles c
where c.company_id=a.company_id and c.employee_id=a.employee_id and c.sequence_no=1;
alter table public.hr_personnel_actions alter column employment_id set not null;
alter table public.hr_personnel_actions add constraint hr_personnel_actions_employment_fk
 foreign key(company_id,employment_id) references public.hr_employment_cycles(company_id,id);

create function private.hr_active_employment(target_company uuid,target_employee uuid,as_of date) returns uuid
language sql stable security definer set search_path='' as $$
 select id from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee
 and cancelled_at is null and hire_date<=as_of and (end_date is null or end_date>as_of)
 order by sequence_no desc limit 1;
$$;

create or replace function private.hr_employee_state(target_company uuid,target_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cycle public.hr_employment_cycles; transfer public.hr_personnel_actions; today date:=(now() at time zone 'Asia/Seoul')::date; state text;
begin
 select * into cycle from public.hr_employment_cycles where id=private.hr_active_employment(target_company,target_employee,today);
 if not found then
  select * into cycle from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and cancelled_at is null
  order by case when hire_date>today then 0 else 1 end, case when hire_date>today then hire_date end, sequence_no desc limit 1;
  if not found then return null;end if;
  state:=case when cycle.hire_date>today then 'planned' else 'terminated' end;
 else state:='active';
 end if;
 select * into transfer from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee
 and employment_id=cycle.id and type='transfer' and cancelled_at is null and effective_date<=today order by effective_date desc,id desc limit 1;
 return jsonb_build_object('employmentId',cycle.id,'employmentSequence',cycle.sequence_no,
 'siteId',coalesce(transfer.site_id,cycle.site_id),'department',coalesce(transfer.department,cycle.department),
 'grade',coalesce(transfer.grade,cycle.grade),'position',coalesce(transfer.position,cycle.position),'status',state,'hireDate',cycle.hire_date);
end;$$;

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
 insert into public.hr_personnel_actions(company_id,employee_id,employment_id,type,effective_date,site_id,department,grade,position,reason,created_by)
 values(target_company,target_employee,cycle.id,action_document->>'type',effective,(action_document->>'siteId')::uuid,action_document->>'department',action_document->>'grade',action_document->>'position',btrim(action_document->>'reason'),auth.uid()) returning id into result;
 if action_document->>'type'='terminate' then update public.hr_employment_cycles set end_date=effective,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=cycle.id;end if;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then raise exception 'invalid_action' using errcode='22023';
end;$$;

create or replace function public.hr_cancel_personnel_action(target_company uuid,target_employee uuid,target_action uuid,expected_revision integer,change_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; action public.hr_personnel_actions;
begin
 perform private.hr_authorize_cancel(target_company);
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into action from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and id=target_action;
 if not found or action.cancelled_at is not null or action.effective_date<=(now() at time zone 'Asia/Seoul')::date
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 or exists(select 1 from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and employment_id=action.employment_id and cancelled_at is null and effective_date>action.effective_date)
 then raise exception 'invalid_action' using errcode='22023';end if;
 if action.type='terminate' and exists(select 1 from public.hr_employment_cycles c join public.hr_employment_cycles base on base.id=action.employment_id
 where c.company_id=target_company and c.employee_id=target_employee and c.cancelled_at is null and c.sequence_no>base.sequence_no)
 then raise exception 'future_employment_exists' using errcode='22023';end if;
 update public.hr_personnel_actions set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(change_reason) where id=target_action;
 if action.type='terminate' then update public.hr_employment_cycles set end_date=null,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=action.employment_id;end if;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
end;$$;

create function private.hr_employment_cancel_allowed(target_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.hr_module_state(target_company) in ('enabled','draining')
 and private.enterprise_granted(target_company,'hr.core','read','company')
 and private.enterprise_granted(target_company,'hr.core','update','company');
$$;
create function private.hr_authorize_employment_cancel(target_company uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.companies where id=target_company for update;
 if not coalesce(private.hr_employment_cancel_allowed(target_company),false) then raise exception 'access_denied' using errcode='42501';end if;
end;$$;

create function private.hr_employment_history_document(target_company uuid,target_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; revision integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 select e.revision into revision from public.hr_employees e where e.company_id=target_company and e.id=target_employee;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'sequenceNo',c.sequence_no,'hireDate',c.hire_date,'endDate',c.end_date,
  'status',case when c.cancelled_at is not null then 'cancelled' when c.hire_date>today then 'planned' when c.end_date is null or c.end_date>today then 'active' else 'terminated' end,
  'siteId',c.site_id,'department',c.department,'grade',c.grade,'position',c.position,
  'cancelled',c.cancelled_at is not null,'cancellationReason',c.cancellation_reason,'accountChanged',c.account_changed,
  'actions',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,'effectiveDate',a.effective_date,'siteId',a.site_id,
   'department',a.department,'grade',a.grade,'position',a.position,'reason',a.reason,'cancelled',a.cancelled_at is not null)
   order by a.effective_date,a.id),'[]'::jsonb) from public.hr_personnel_actions a where a.company_id=c.company_id and a.employee_id=c.employee_id and a.employment_id=c.id)
 ) order by c.sequence_no),'[]'::jsonb) into result
 from public.hr_employment_cycles c where c.company_id=target_company and c.employee_id=target_employee;
 return jsonb_build_object('companyId',target_company,'employeeId',target_employee,'employeeRevision',revision,
 'permissions',jsonb_build_object('create',private.enterprise_allowed(target_company,'hr.core','update','company'),
 'cancel',private.hr_employment_cancel_allowed(target_company)),'employments',result);
end;$$;

create function public.hr_employment_history(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.hr_authorize(target_company,'read');
 return private.hr_employment_history_document(target_company,target_employee);
end;$$;

create function public.hr_prepare_rehire(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare employee public.hr_employees; latest public.hr_employment_cycles; state jsonb; candidates jsonb; sites jsonb; refs jsonb; mappings jsonb; account jsonb;
begin
 perform private.hr_authorize(target_company,'read');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 select * into latest from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and cancelled_at is null order by sequence_no desc limit 1;
 state:=private.hr_employee_state(target_company,target_employee);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'preview',private.hr_preview_level(target_company,c.id,state->>'grade',state->>'position')) order by c.name,c.id),'[]'::jsonb)
 into candidates from private.hr_link_candidates(target_company,target_employee)c;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) into sites from public.sites where company_id=target_company and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'code',code,'name',name) order by kind,code),'[]'::jsonb) into refs from public.hr_reference_codes where company_id=target_company and is_active;
 select coalesce(jsonb_agg(m),'[]'::jsonb) into mappings from jsonb_array_elements(coalesce((select policy->'mappings' from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1),'[]'::jsonb))m where private.enterprise_valid_now(m);
 if employee.profile_id is null then account:=null;else select jsonb_build_object('id',id,'name',coalesce(nullif(display_name,''),email)) into account from public.profiles where id=employee.profile_id;end if;
 return jsonb_build_object('companyId',target_company,'employeeId',target_employee,'employeeRevision',employee.revision,
 'eligible',latest.end_date is not null and not exists(select 1 from public.hr_employment_cycles c where c.company_id=target_company and c.employee_id=target_employee and c.cancelled_at is null and c.sequence_no>latest.sequence_no),
 'earliestHireDate',case when latest.end_date is null then null else latest.end_date+1 end,
 'currentAccount',account,'accountCandidates',candidates,'sites',sites,'references',refs,'mappings',mappings,
 'permissions',jsonb_build_object('create',private.enterprise_allowed(target_company,'hr.core','update','company')));
end;$$;

create function public.hr_create_reemployment(target_company uuid,target_employee uuid,expected_revision integer,employment_document jsonb,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; latest public.hr_employment_cycles; result uuid; start_date date; mode text; next_profile uuid; changed boolean; next_sequence integer;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if not private.enterprise_object(employment_document,array['hireDate','siteId','department','grade','position','accountMode','profileId'])
 or jsonb_typeof(employment_document->'hireDate')<>'string' or employment_document->>'hireDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(employment_document->'accountMode')<>'string' or employment_document->>'accountMode' not in ('keep','unlink','replace')
 or jsonb_typeof(employment_document->'profileId') not in ('null','string')
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_employment' using errcode='22023';end if;
 start_date:=(employment_document->>'hireDate')::date;mode:=employment_document->>'accountMode';
 select * into latest from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and cancelled_at is null order by sequence_no desc limit 1 for update;
 select coalesce(max(sequence_no),0)+1 into next_sequence from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee;
 if not found or latest.end_date is null then raise exception 'rehire_not_allowed' using errcode='22023';end if;
 if start_date<=latest.end_date then raise exception 'employment_overlap' using errcode='22023';end if;
 if start_date<=(now() at time zone 'Asia/Seoul')::date then raise exception 'invalid_employment' using errcode='22023';end if;
 perform private.hr_validate_assignment(target_company,employment_document);
 if mode='keep' and employment_document->>'profileId' is not null or mode='unlink' and employment_document->>'profileId' is not null or mode='replace' and employment_document->>'profileId' is null then raise exception 'invalid_employment' using errcode='22023';end if;
 next_profile:=case when mode='keep' then employee.profile_id when mode='unlink' then null else (employment_document->>'profileId')::uuid end;
 if mode='replace' and not exists(select 1 from private.hr_link_candidates(target_company,target_employee)c where c.id=next_profile) then raise exception 'account_unavailable' using errcode='22023';end if;
 changed:=next_profile is distinct from employee.profile_id;
 insert into public.hr_employment_cycles(company_id,employee_id,sequence_no,hire_date,site_id,department,grade,position,reason,created_by,updated_by,
 account_changed,previous_profile_id,rehire_profile_id)
 values(target_company,target_employee,next_sequence,start_date,(employment_document->>'siteId')::uuid,employment_document->>'department',employment_document->>'grade',
 employment_document->>'position',btrim(change_reason),auth.uid(),auth.uid(),changed,case when changed then employee.profile_id end,case when changed then next_profile end) returning id into result;
 if changed then
  update public.hr_employees set profile_id=next_profile where id=target_employee;
  insert into public.hr_employee_account_links(company_id,employee_id,before_profile,after_profile,reason,created_by)
  values(target_company,target_employee,employee.profile_id,next_profile,btrim(change_reason),auth.uid());
 end if;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return private.hr_employment_history_document(target_company,target_employee);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or unique_violation or foreign_key_violation then raise exception 'invalid_employment' using errcode='22023';
end;$$;

create function public.hr_cancel_planned_employment(target_company uuid,target_employee uuid,target_employment uuid,expected_revision integer,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; cycle public.hr_employment_cycles;
begin
 perform private.hr_authorize_employment_cancel(target_company);
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 select * into cycle from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee and id=target_employment for update;
 if not found or cycle.cancelled_at is not null or cycle.hire_date<=(now() at time zone 'Asia/Seoul')::date
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 or exists(select 1 from public.hr_employment_cycles c where c.company_id=target_company and c.employee_id=target_employee and c.cancelled_at is null and c.sequence_no>cycle.sequence_no)
 then raise exception 'planned_employment_required' using errcode='22023';end if;
 update public.hr_employment_cycles set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(change_reason),revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=cycle.id;
 if cycle.account_changed and employee.profile_id is not distinct from cycle.rehire_profile_id
 and (cycle.previous_profile_id is null or not exists(select 1 from public.hr_employees e where e.company_id=target_company and e.profile_id=cycle.previous_profile_id and e.id<>target_employee))
 then
  update public.hr_employees set profile_id=cycle.previous_profile_id where id=target_employee;
  insert into public.hr_employee_account_links(company_id,employee_id,before_profile,after_profile,reason,created_by)
  values(target_company,target_employee,employee.profile_id,cycle.previous_profile_id,'재입사 취소: '||btrim(change_reason),auth.uid());
 end if;
 update public.hr_employees set revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 return private.hr_employment_history_document(target_company,target_employee);
end;$$;

create or replace function private.hr_module_pending(target_company uuid) returns integer
language sql stable security definer set search_path='' as $$
 select (select count(*) from public.hr_personnel_actions where company_id=target_company and cancelled_at is null and effective_date>(now() at time zone 'Asia/Seoul')::date)
 +(select count(*) from public.hr_employment_cycles where company_id=target_company and cancelled_at is null and sequence_no>1 and hire_date>(now() at time zone 'Asia/Seoul')::date);
$$;

create or replace function private.hr_reference_in_use(target_company uuid,reference_kind text,reference_code text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hr_employees e cross join lateral(select private.hr_employee_state(target_company,e.id)s)x where e.company_id=target_company and x.s->>'status' in ('active','planned') and x.s->>reference_kind=reference_code)
 or exists(select 1 from public.hr_employment_cycles c where c.company_id=target_company and c.cancelled_at is null and c.hire_date>(now() at time zone 'Asia/Seoul')::date and to_jsonb(c)->>reference_kind=reference_code)
 or exists(select 1 from public.hr_personnel_actions a where a.company_id=target_company and a.cancelled_at is null and a.type='transfer' and a.effective_date>(now() at time zone 'Asia/Seoul')::date and to_jsonb(a)->>reference_kind=reference_code)
 or (reference_kind='department' and exists(select 1 from public.hr_reference_codes r where r.company_id=target_company and r.kind='department' and r.is_active and r.parent_code=reference_code));
$$;

create or replace function public.hr_correct_employee(target_company uuid,target_employee uuid,expected_revision integer,correction_document jsonb,change_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; first_hire date; before_doc jsonb; after_doc jsonb;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if not private.enterprise_object(correction_document,array['name'])
 or jsonb_typeof(correction_document->'name')<>'string' or length(btrim(correction_document->>'name')) not between 1 and 100
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 then raise exception 'invalid_correction' using errcode='22023';end if;
 select hire_date into first_hire from public.hr_employment_cycles where company_id=target_company and employee_id=target_employee order by sequence_no limit 1;
 before_doc:=jsonb_build_object('name',employee.name,'hireDate',first_hire);
 after_doc:=jsonb_build_object('name',btrim(correction_document->>'name'),'hireDate',first_hire);
 update public.hr_employees set name=btrim(correction_document->>'name'),revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target_employee;
 insert into public.hr_employee_correction_audit(company_id,employee_id,before_document,after_document,reason,created_by)
 values(target_company,target_employee,before_doc,after_doc,btrim(change_reason),auth.uid());
end;$$;

alter function private.hr_active_employment(uuid,uuid,date) owner to postgres;
alter function private.hr_employee_state(uuid,uuid) owner to postgres;
alter function private.hr_employment_cancel_allowed(uuid) owner to postgres;
alter function private.hr_authorize_employment_cancel(uuid) owner to postgres;
alter function private.hr_employment_history_document(uuid,uuid) owner to postgres;
revoke all on function private.hr_active_employment(uuid,uuid,date),private.hr_employee_state(uuid,uuid),private.hr_employment_cancel_allowed(uuid),private.hr_authorize_employment_cancel(uuid),private.hr_employment_history_document(uuid,uuid) from public,anon,authenticated;
alter function public.hr_employment_history(uuid,uuid) owner to postgres;
alter function public.hr_prepare_rehire(uuid,uuid) owner to postgres;
alter function public.hr_create_reemployment(uuid,uuid,integer,jsonb,text) owner to postgres;
alter function public.hr_cancel_planned_employment(uuid,uuid,uuid,integer,text) owner to postgres;
revoke all on function public.hr_employment_history(uuid,uuid),public.hr_prepare_rehire(uuid,uuid),public.hr_create_reemployment(uuid,uuid,integer,jsonb,text),public.hr_cancel_planned_employment(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.hr_employment_history(uuid,uuid),public.hr_prepare_rehire(uuid,uuid),public.hr_create_reemployment(uuid,uuid,integer,jsonb,text),public.hr_cancel_planned_employment(uuid,uuid,uuid,integer,text) to authenticated;
