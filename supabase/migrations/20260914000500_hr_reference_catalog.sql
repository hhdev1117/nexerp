-- Catalog and correction writes are RPC-only. All assignment-affecting writes
-- serialize on companies, including cancellation and hire-date corrections.
create table public.hr_reference_codes (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 kind text not null check(kind in ('department','grade','position')),code text not null check(length(code) between 1 and 150),
 name text not null check(length(btrim(name)) between 1 and 150),parent_code text,is_active boolean not null default true,
 revision integer not null default 1 check(revision>0),created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),updated_at timestamptz not null default now(),
 unique(company_id,kind,code),unique(company_id,id),check(kind='department' or parent_code is null)
);
create table public.hr_reference_audit (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,reference_id uuid not null,
 before_document jsonb,after_document jsonb not null,reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(company_id,reference_id) references public.hr_reference_codes(company_id,id)
);
create table public.hr_employee_correction_audit (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,
 before_document jsonb not null,after_document jsonb not null,reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id)
);
alter table public.hr_reference_codes enable row level security;
alter table public.hr_reference_audit enable row level security;
alter table public.hr_employee_correction_audit enable row level security;
revoke all on public.hr_reference_codes,public.hr_reference_audit,public.hr_employee_correction_audit from public,anon,authenticated;
-- Preserve exact legacy codes; trimming an existing code would change mappings.
insert into public.hr_reference_codes(company_id,kind,code,name)
select distinct company_id,kind,code,case when btrim(code)='' then '기존 공백 코드' else code end from (
 select e.company_id,v.kind,v.code from public.hr_employees e cross join lateral(values('department',e.department),('grade',e.grade),('position',e.position))v(kind,code)
 union all select a.company_id,v.kind,v.code from public.hr_personnel_actions a cross join lateral(values('department',a.department),('grade',a.grade),('position',a.position))v(kind,code)
 union all select p.company_id,m->>'kind',m->>'code' from (select company_id,policy from public.enterprise_access_policies union all select company_id,policy from public.enterprise_access_publications)p cross join lateral jsonb_array_elements(p.policy->'mappings')m
) legacy where length(code)>0 on conflict do nothing;
create function private.hr_reference_json(r public.hr_reference_codes) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',r.id,'companyId',r.company_id,'kind',r.kind,'code',r.code,'name',r.name,'parentCode',r.parent_code,'isActive',r.is_active,'revision',r.revision);
$$;
create function public.hr_reference_catalog(target_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.hr_authorize(target_company,'read');
 return jsonb_build_object('items',(select coalesce(jsonb_agg(private.hr_reference_json(r) order by r.kind,r.code),'[]'::jsonb) from public.hr_reference_codes r where company_id=target_company),'canManage',private.enterprise_allowed(target_company,'hr.core','update','company'));
end;$$;
create function private.hr_reference_in_use(target_company uuid,reference_kind text,reference_code text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hr_employees e cross join lateral (select private.hr_employee_state(target_company,e.id) s)x where e.company_id=target_company and x.s->>'status' in ('active','planned') and x.s->>reference_kind=reference_code)
 or exists(select 1 from public.hr_personnel_actions a where a.company_id=target_company and a.cancelled_at is null and a.type='transfer' and a.effective_date>(now() at time zone 'Asia/Seoul')::date and (to_jsonb(a)->>reference_kind)=reference_code)
 or (reference_kind='department' and exists(select 1 from public.hr_reference_codes r where r.company_id=target_company and r.kind='department' and r.is_active and r.parent_code=reference_code));
$$;
create function public.hr_save_reference(target_company uuid,reference_document jsonb,expected_revision integer,change_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare old_row public.hr_reference_codes; new_row public.hr_reference_codes; rid uuid; k text; c text; parent text; active boolean;
begin
 perform private.hr_authorize(target_company,'update');
 perform 1 from public.companies where id=target_company for update;
 if not private.enterprise_object(reference_document,array['id','kind','code','name','parentCode','isActive']) or change_reason is null or length(btrim(change_reason)) not between 1 and 2000
 or jsonb_typeof(reference_document->'id') not in ('null','string') or jsonb_typeof(reference_document->'kind')<>'string' or reference_document->>'kind' not in ('department','grade','position')
 or jsonb_typeof(reference_document->'code')<>'string' or length(reference_document->>'code') not between 1 and 150
 or jsonb_typeof(reference_document->'name')<>'string' or length(btrim(reference_document->>'name')) not between 1 and 150
 or jsonb_typeof(reference_document->'parentCode') not in ('null','string') or jsonb_typeof(reference_document->'isActive')<>'boolean'
 then raise exception 'invalid_reference' using errcode='22023';end if;
 rid:=(reference_document->>'id')::uuid;k:=reference_document->>'kind';c:=reference_document->>'code';parent:=reference_document->>'parentCode';active:=(reference_document->>'isActive')::boolean;
 if rid is not null then
 select * into old_row from public.hr_reference_codes where company_id=target_company and id=rid for update;
 if not found then raise exception 'invalid_reference' using errcode='22023';end if;
 if expected_revision is distinct from old_row.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if c<>old_row.code or k<>old_row.kind then raise exception 'immutable_reference' using errcode='22023';end if;
 else
 if expected_revision is distinct from 0 then raise exception 'revision_conflict' using errcode='40001';end if;
 c:=btrim(c);
 if length(c)=0 then raise exception 'invalid_reference' using errcode='22023';end if;
 end if;
 if parent is not null then
 if k<>'department' or parent=c or not exists(select 1 from public.hr_reference_codes where company_id=target_company and kind='department' and code=parent and (not active or is_active))
 or exists(with recursive ancestors as (select code,parent_code from public.hr_reference_codes where company_id=target_company and kind='department' and code=parent union select r.code,r.parent_code from public.hr_reference_codes r join ancestors a on r.code=a.parent_code where r.company_id=target_company and r.kind='department')select 1 from ancestors where code=c)
 then raise exception 'invalid_parent' using errcode='22023';end if;
 end if;
 if not active and private.hr_reference_in_use(target_company,k,c) then raise exception 'reference_in_use' using errcode='22023';end if;
 if rid is null then
 insert into public.hr_reference_codes(company_id,kind,code,name,parent_code,is_active,created_by,updated_by) values(target_company,k,c,btrim(reference_document->>'name'),parent,active,auth.uid(),auth.uid()) returning * into new_row;
 else
 update public.hr_reference_codes set name=btrim(reference_document->>'name'),parent_code=parent,is_active=active,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=rid returning * into new_row;
 end if;
 insert into public.hr_reference_audit(company_id,reference_id,before_document,after_document,reason,created_by) values(target_company,new_row.id,case when rid is null then null else private.hr_reference_json(old_row) end,private.hr_reference_json(new_row),btrim(change_reason),auth.uid());
 return new_row.id;
exception when invalid_text_representation or unique_violation then raise exception 'invalid_reference' using errcode='22023';
end;$$;
create function private.hr_check_reference_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare field text; code_value text;
begin
 perform 1 from public.companies where id=new.company_id for update;
 if tg_table_name='hr_personnel_actions' then
 -- Cancellation may restore an earlier assignment. Validate the resulting state
 -- in the AFTER trigger below, without rejecting historical inactive rows here.
 if tg_op='UPDATE' or new.type='terminate' then return new;end if;
 elsif tg_op='UPDATE' then return new;
 end if;
 foreach field in array array['department','grade','position'] loop
 code_value:=to_jsonb(new)->>field;
 if code_value<>'' and not exists(select 1 from public.hr_reference_codes where company_id=new.company_id and kind=field and code=code_value and is_active) then raise exception 'invalid_reference' using errcode='22023';end if;
 end loop;
 return new;
end;$$;
create trigger hr_employee_reference_lock before insert or update on public.hr_employees for each row execute function private.hr_check_reference_assignment();
create trigger hr_action_reference_lock before insert or update on public.hr_personnel_actions for each row execute function private.hr_check_reference_assignment();
create function private.hr_check_restored_references() returns trigger language plpgsql security definer set search_path='' as $$
declare state jsonb; field text;
begin
 if tg_table_name='hr_personnel_actions' then
 if new.cancelled_at is not distinct from old.cancelled_at then return new;end if;
 state:=private.hr_employee_state(new.company_id,new.employee_id);
 else
 if new.hire_date is not distinct from old.hire_date then return new;end if;
 state:=private.hr_employee_state(new.company_id,new.id);
 end if;
 if state->>'status' in ('active','planned') then
 foreach field in array array['department','grade','position'] loop
 if state->>field<>'' and not exists(select 1 from public.hr_reference_codes where company_id=new.company_id and kind=field and code=state->>field and is_active) then raise exception 'invalid_reference' using errcode='22023';end if;
 end loop;
 end if;
 return new;
end;$$;
create trigger hr_employee_restored_references after update on public.hr_employees for each row execute function private.hr_check_restored_references();
create trigger hr_action_restored_references after update on public.hr_personnel_actions for each row execute function private.hr_check_restored_references();
create function public.hr_correct_employee(target_company uuid,target_employee uuid,expected_revision integer,correction_document jsonb,change_reason text) returns void language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; corrected_date date; before_doc jsonb;after_doc jsonb;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023';end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001';end if;
 if not private.enterprise_object(correction_document,array['name','hireDate']) or jsonb_typeof(correction_document->'name')<>'string' or length(btrim(correction_document->>'name')) not between 1 and 100
 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_employee' using errcode='22023';end if;
 if jsonb_typeof(correction_document->'hireDate')<>'string' or correction_document->>'hireDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_correction_date' using errcode='22023';end if;
 corrected_date:=(correction_document->>'hireDate')::date;
 if exists(select 1 from public.hr_personnel_actions where company_id=target_company and employee_id=target_employee and effective_date<corrected_date) then raise exception 'invalid_correction_date' using errcode='22023';end if;
 before_doc:=jsonb_build_object('name',employee.name,'hireDate',employee.hire_date);after_doc:=jsonb_build_object('name',btrim(correction_document->>'name'),'hireDate',corrected_date);
 update public.hr_employees set name=btrim(correction_document->>'name'),hire_date=corrected_date,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=target_employee;
 insert into public.hr_employee_correction_audit(company_id,employee_id,before_document,after_document,reason,created_by) values(target_company,target_employee,before_doc,after_doc,btrim(change_reason),auth.uid());
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_correction_date' using errcode='22023';
end;$$;
create function public.hr_employee_corrections(target_company uuid,target_employee uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.hr_authorize(target_company,'read');
 if not exists(select 1 from public.hr_employees where company_id=target_company and id=target_employee) then raise exception 'invalid_employee' using errcode='22023';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'before',before_document,'after',after_document,'reason',reason,'createdAt',created_at) order by created_at,id),'[]'::jsonb) from public.hr_employee_correction_audit where company_id=target_company and employee_id=target_employee);
end;$$;
revoke all on function private.hr_reference_json(public.hr_reference_codes),private.hr_reference_in_use(uuid,text,text),private.hr_check_reference_assignment(),private.hr_check_restored_references() from public,anon,authenticated;
revoke all on function public.hr_reference_catalog(uuid),public.hr_save_reference(uuid,jsonb,integer,text),public.hr_correct_employee(uuid,uuid,integer,jsonb,text),public.hr_employee_corrections(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hr_reference_catalog(uuid),public.hr_save_reference(uuid,jsonb,integer,text),public.hr_correct_employee(uuid,uuid,integer,jsonb,text),public.hr_employee_corrections(uuid,uuid) to authenticated;
alter function private.hr_reference_json(public.hr_reference_codes) owner to postgres;
alter function private.hr_reference_in_use(uuid,text,text) owner to postgres;
alter function private.hr_check_reference_assignment() owner to postgres;
alter function private.hr_check_restored_references() owner to postgres;
alter function public.hr_reference_catalog(uuid) owner to postgres;
alter function public.hr_save_reference(uuid,jsonb,integer,text) owner to postgres;
alter function public.hr_correct_employee(uuid,uuid,integer,jsonb,text) owner to postgres;
alter function public.hr_employee_corrections(uuid,uuid) owner to postgres;
