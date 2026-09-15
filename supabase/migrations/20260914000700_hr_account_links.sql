-- Account linking decides who can act as an employee, so it is an update-level
-- HR operation with its own audit trail rather than a silent profile edit.
create table public.hr_employee_account_links (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id), employee_id uuid not null,
 before_profile uuid references public.profiles(id), after_profile uuid references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 check(before_profile is distinct from after_profile),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id)
);
alter table public.hr_employee_account_links enable row level security;
revoke all on public.hr_employee_account_links from public,anon,authenticated;
create index hr_employee_account_links_employee_idx on public.hr_employee_account_links(company_id,employee_id,created_at desc);

-- Preview only mirrors the published policy. It never grants a level by itself.
create function private.hr_preview_level(target_company uuid,target_profile uuid,grade_code text,position_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare document jsonb; member jsonb; resolved integer; origin text;
begin
 select policy into document from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1;
 if document is null then return jsonb_build_object('level',null,'source','unpublished'); end if;
 if target_profile is null then return jsonb_build_object('level',null,'source','unlinked'); end if;
 select m into member from jsonb_array_elements(document->'members') m
 where m->>'id'=target_profile::text and m->>'active'='true' and private.enterprise_valid_now(m) limit 1;
 if member is null then return jsonb_build_object('level',null,'source','not_member'); end if;
 resolved:=(member->>'level')::integer; origin:='direct';
 if resolved is null then
  select (m->>'level')::integer,m->>'kind' into resolved,origin from jsonb_array_elements(document->'mappings') m
  where private.enterprise_valid_now(m) and ((m->>'kind'='position' and m->>'code'=position_code) or (m->>'kind'='grade' and m->>'code'=grade_code))
  order by case when m->>'kind'='position' then 0 else 1 end limit 1;
 end if;
 if resolved is null then return jsonb_build_object('level',null,'source','unmapped'); end if;
 return jsonb_build_object('level',resolved,'source',origin);
end;$$;

-- Candidates keep the employee's own account visible while excluding accounts
-- already tied to another employee of the same company.
create function private.hr_link_candidates(target_company uuid,target_employee uuid) returns table(id uuid,name text)
language sql stable security definer set search_path='' as $$
 select p.id,m->>'name' from jsonb_array_elements(
 coalesce((select policy->'members' from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1),'[]'::jsonb)
 ) m join public.profiles p on p.id=(m->>'id')::uuid
 where m->>'active'='true' and p.is_active
 and not exists(select 1 from public.hr_employees e where e.company_id=target_company and e.profile_id=p.id and e.id<>target_employee);
$$;

create function private.hr_account_link_document(target_company uuid,target_employee uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare employee public.hr_employees; state jsonb; candidates jsonb; linked jsonb; may_update boolean;
begin
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee;
 if not found then raise exception 'invalid_employee' using errcode='22023'; end if;
 state:=private.hr_employee_state(target_company,target_employee);
 may_update:=coalesce(private.enterprise_allowed(target_company,'hr.core','update','company'),false);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
  'preview',private.hr_preview_level(target_company,c.id,state->>'grade',state->>'position')) order by c.name,c.id),'[]'::jsonb)
  into candidates from private.hr_link_candidates(target_company,target_employee) c;
 if employee.profile_id is null then linked:=null;
 else select jsonb_build_object('id',p.id,'name',coalesce(nullif(c.name,''),nullif(p.display_name,''),'이름 미등록'),
  'listed',c.id is not null,'preview',private.hr_preview_level(target_company,p.id,state->>'grade',state->>'position')) into linked
  from public.profiles p left join private.hr_link_candidates(target_company,target_employee) c on c.id=p.id where p.id=employee.profile_id;
 end if;
 return jsonb_build_object('companyId',target_company,'employeeId',target_employee,'employeeNo',employee.employee_no,
 'name',employee.name,'revision',employee.revision,'status',state->>'status','grade',state->>'grade','position',state->>'position',
 'account',linked,'candidates',candidates,
 'permissions',jsonb_build_object('link',may_update and state->>'status'<>'terminated','unlink',may_update and employee.profile_id is not null));
end;$$;

create function public.hr_account_link_options(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.hr_authorize(target_company,'read');
 return private.hr_account_link_document(target_company,target_employee);
end;$$;

create function public.hr_link_employee_account(target_company uuid,target_employee uuid,expected_revision integer,target_profile uuid,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee public.hr_employees; state jsonb;
begin
 perform private.hr_authorize(target_company,'update');
 select * into employee from public.hr_employees where company_id=target_company and id=target_employee for update;
 if not found then raise exception 'invalid_employee' using errcode='22023'; end if;
 if expected_revision is distinct from employee.revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 if change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_account_link' using errcode='22023'; end if;
 if target_profile is not distinct from employee.profile_id then raise exception 'account_link_unchanged' using errcode='22023'; end if;
 state:=private.hr_employee_state(target_company,target_employee);
 if target_profile is not null then
  -- Terminated employees keep their history but never receive a new account.
  if state->>'status'='terminated' then raise exception 'employee_terminated' using errcode='22023'; end if;
  if not exists(select 1 from private.hr_link_candidates(target_company,target_employee) c where c.id=target_profile) then raise exception 'account_unavailable' using errcode='22023'; end if;
 end if;
 update public.hr_employees set profile_id=target_profile,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=target_employee;
 insert into public.hr_employee_account_links(company_id,employee_id,before_profile,after_profile,reason,created_by)
 values(target_company,target_employee,employee.profile_id,target_profile,btrim(change_reason),auth.uid());
 -- Build the response without re-authorizing against the just-changed employee
 -- link. Otherwise an authorized operator replacing their own link could cause
 -- the successful mutation to roll back during response construction.
 return private.hr_account_link_document(target_company,target_employee);
exception when unique_violation or foreign_key_violation then raise exception 'account_unavailable' using errcode='22023';
end;$$;

create function public.hr_account_link_history(target_company uuid,target_employee uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.hr_authorize(target_company,'read');
 if not exists(select 1 from public.hr_employees where company_id=target_company and id=target_employee) then raise exception 'invalid_employee' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'beforeAccountId',l.before_profile,'afterAccountId',l.after_profile,
 'beforeAccountName',coalesce(nullif(b.display_name,''),'-'),'afterAccountName',coalesce(nullif(a.display_name,''),'-'),
 'reason',l.reason,'createdAt',l.created_at) order by l.created_at desc,l.id desc),'[]'::jsonb) into result
 from public.hr_employee_account_links l
 left join public.profiles b on b.id=l.before_profile left join public.profiles a on a.id=l.after_profile
 where l.company_id=target_company and l.employee_id=target_employee;
 return result;
end;$$;

alter function private.hr_preview_level(uuid,uuid,text,text) owner to postgres;
revoke all on function private.hr_preview_level(uuid,uuid,text,text) from public,anon,authenticated;
alter function private.hr_link_candidates(uuid,uuid) owner to postgres;
revoke all on function private.hr_link_candidates(uuid,uuid) from public,anon,authenticated;
alter function private.hr_account_link_document(uuid,uuid) owner to postgres;
revoke all on function private.hr_account_link_document(uuid,uuid) from public,anon,authenticated;
alter function public.hr_account_link_options(uuid,uuid) owner to postgres;
alter function public.hr_link_employee_account(uuid,uuid,integer,uuid,text) owner to postgres;
alter function public.hr_account_link_history(uuid,uuid) owner to postgres;
revoke all on function public.hr_account_link_options(uuid,uuid),public.hr_link_employee_account(uuid,uuid,integer,uuid,text),public.hr_account_link_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hr_account_link_options(uuid,uuid),public.hr_link_employee_account(uuid,uuid,integer,uuid,text),public.hr_account_link_history(uuid,uuid) to authenticated;
