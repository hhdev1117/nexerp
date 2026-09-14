-- Immutable publication history; drafts are never consulted by runtime authorization.
create table public.enterprise_access_publications (
 company_id uuid not null references public.companies(id),
 revision integer not null check(revision > 0),
 draft_revision integer not null,
 policy jsonb not null,
 operation text not null check(operation in ('publish','revert')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(company_id,revision)
);
alter table public.enterprise_access_publications enable row level security;
revoke all on public.enterprise_access_publications from public,anon,authenticated;

create function public.enterprise_access_publication(target_company uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 select jsonb_build_object('revision',p.revision,'draftRevision',p.draft_revision,'active',true) into result from public.enterprise_access_publications p where company_id=target_company order by revision desc limit 1;
 return coalesce(result,jsonb_build_object('revision',0,'draftRevision',null,'active',false));
end; $$;
create function private.enterprise_publish(target_company uuid,draft_revision integer,expected_revision integer,change_reason text,reverting boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision integer; snapshot jsonb; source_revision integer;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 perform 1 from public.companies where id=target_company for update;
 if not found or expected_revision is null or expected_revision < 0 or change_reason is null or length(btrim(change_reason)) not between 1 and 2000 then raise exception 'invalid_publication' using errcode='22023'; end if;
 select coalesce(max(revision),0) into current_revision from public.enterprise_access_publications where company_id=target_company;
 if current_revision <> expected_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 if reverting then
  select policy,p.draft_revision into snapshot,source_revision from public.enterprise_access_publications p where company_id=target_company and revision=current_revision-1;
  if not found then raise exception 'no_previous_publication' using errcode='22023'; end if;
 else
  select policy,revision into snapshot,source_revision from public.enterprise_access_policies where company_id=target_company;
  if not found or draft_revision is null or source_revision <> draft_revision then raise exception 'draft_revision_conflict' using errcode='40001'; end if;
  if not exists(select 1 from jsonb_array_elements(snapshot->'members') m join public.profiles p on p.id=(m->>'id')::uuid where p.is_active and m->>'active'='true' and private.enterprise_valid_now(m) and
   (m->>'level' is not null or exists(select 1 from jsonb_array_elements(snapshot->'overrides') o where o->>'actorId'=m->>'id' and o->>'effect'='allow' and private.enterprise_valid_now(o)) or exists(select 1 from jsonb_array_elements(snapshot->'roles') r where r->'members' ? (m->>'id')) or exists(select 1 from jsonb_array_elements(snapshot->'mappings') mapping where private.enterprise_valid_now(mapping) and ((mapping->>'kind'='position' and mapping->>'code'=m->>'position') or (mapping->>'kind'='grade' and mapping->>'code'=m->>'grade'))))) then
   raise exception 'no_active_membership' using errcode='22023';
  end if;
 end if;
 insert into public.enterprise_access_publications values(target_company,current_revision+1,source_revision,snapshot,case when reverting then 'revert' else 'publish' end,btrim(change_reason),auth.uid(),now());
 return jsonb_build_object('revision',current_revision+1,'draftRevision',source_revision,'active',true);
end; $$;
create function public.enterprise_publish_access_policy(target_company uuid,draft_revision integer,expected_revision integer,change_reason text) returns jsonb
language sql security definer set search_path = '' as $$ select private.enterprise_publish(target_company,draft_revision,expected_revision,change_reason,false); $$;
create function public.enterprise_revert_access_policy(target_company uuid,expected_revision integer,change_reason text) returns jsonb
language sql security definer set search_path = '' as $$ select private.enterprise_publish(target_company,null,expected_revision,change_reason,true); $$;

create function private.enterprise_valid_now(item jsonb) returns boolean
language sql stable set search_path = '' as $$
 select ((item->>'from') is null or (item->>'from')::date <= (now() at time zone 'Asia/Seoul')::date)
 and ((item->>'to') is null or (item->>'to')::date > (now() at time zone 'Asia/Seoul')::date);
$$;
create function private.enterprise_member(document jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
 select m from jsonb_array_elements(document->'members') m where m->>'id'=auth.uid()::text and m->>'active'='true' and private.enterprise_valid_now(m) and private.is_active_user();
$$;
-- scope_filter is a navigation candidate; row_site is used only for concrete master rows.
create function private.enterprise_allowed(target_company uuid,resource_key text,action_key text,scope_filter text default null,row_site uuid default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare document jsonb; member jsonb; effective_level integer; grants jsonb; overrides jsonb;
begin
 if not coalesce(private.is_active_user(),false) then return false; end if;
 if not exists(select 1 from public.companies where id=target_company and (is_active or (resource_key='settings.company' and action_key in ('menu','read','update')))) then return false; end if;
 select policy into document from public.enterprise_access_publications where company_id=target_company order by revision desc limit 1;
 member := private.enterprise_member(document);
 if member is null then return false; end if;
 effective_level := (member->>'level')::integer;
 if effective_level is null then
  select (m->>'level')::integer into effective_level from jsonb_array_elements(document->'mappings') m where private.enterprise_valid_now(m) and ((m->>'kind'='position' and m->>'code'=member->>'position') or (m->>'kind'='grade' and m->>'code'=member->>'grade')) order by case when m->>'kind'='position' then 0 else 1 end limit 1;
 end if;
 select coalesce(jsonb_agg(p),'[]'::jsonb) into grants from jsonb_array_elements((document->'levels')||(document->'roles')) r cross join lateral jsonb_array_elements(r->'permissions') p where (r ? 'id' and r->>'id'=effective_level::text and not r ? 'members') or (r->'members' ? (member->>'id'));
 select coalesce(jsonb_agg(o),'[]'::jsonb) into overrides from jsonb_array_elements(document->'overrides') o where o->>'actorId'=member->>'id' and private.enterprise_valid_now(o);
 -- A matching deny always wins, including company-wide denies against a narrower navigation grant.
 if exists(select 1 from jsonb_array_elements(overrides) p where p->>'effect'='deny' and p->>'resource'=resource_key and p->>'action'=action_key and
  (case when scope_filter is not null then (p->>'scope' in ('company',scope_filter) or (scope_filter='organization' and p->>'scope'='organization_tree')) else p->>'scope'='company' or (p->>'scope'='site' and row_site is not null and member->>'siteId'=row_site::text) end)) then return false; end if;
 return exists(select 1 from jsonb_array_elements(grants||overrides) p where coalesce(p->>'effect','allow')='allow' and p->>'resource'=resource_key and p->>'action'=action_key and
  (case when scope_filter is not null then p->>'scope'=scope_filter and (scope_filter <> 'site' or nullif(member->>'siteId','') is not null) and (scope_filter not in ('organization','organization_tree') or nullif(member->>'organizationId','') is not null) else p->>'scope'='company' or (p->>'scope'='site' and row_site is not null and member->>'siteId'=row_site::text) end));
end; $$;
create function public.enterprise_access_companies() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(private.is_admin(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb) from public.companies);
end; $$;
create function public.enterprise_access_context(target_company uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare catalog jsonb; selected uuid; rev integer; menus jsonb; global_active boolean; legacy boolean; company_actions jsonb; site_actions jsonb;
begin
 if not coalesce(private.is_active_user(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 select exists(select 1 from public.enterprise_access_publications) into global_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) into catalog from public.companies c where (not global_active or private.is_admin() or private.enterprise_member((select policy from public.enterprise_access_publications where company_id=c.id order by revision desc limit 1)) is not null);
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
-- Legacy access is possible only before activation globally or for technical recovery.
create function private.enterprise_master_access(target_company uuid,action_key text,row_site uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
 select case when exists(select 1 from public.enterprise_access_publications where company_id=target_company)
 then private.enterprise_allowed(target_company,'settings.company',action_key,null,row_site)
 else private.is_admin() or (action_key='read' and private.is_active_user() and not exists(select 1 from public.enterprise_access_publications)) end;
$$;
drop policy "Active users read companies" on public.companies;
drop policy "Active admins update companies" on public.companies;
drop policy "Active users read sites" on public.sites;
drop policy "Active admins insert sites" on public.sites;
drop policy "Active admins update sites" on public.sites;
create policy "Enterprise read companies" on public.companies for select to authenticated using(private.enterprise_master_access(id,'read'));
create policy "Enterprise update companies" on public.companies for update to authenticated using(private.enterprise_master_access(id,'update')) with check(private.enterprise_master_access(id,'update'));
create policy "Enterprise read sites" on public.sites for select to authenticated using(private.enterprise_master_access(company_id,'read',id));
create policy "Enterprise create sites" on public.sites for insert to authenticated with check(private.enterprise_master_access(company_id,'create',id));
create policy "Enterprise update sites" on public.sites for update to authenticated using(private.enterprise_master_access(company_id,'update',id)) with check(private.enterprise_master_access(company_id,'update',id));

revoke all on function private.enterprise_publish(uuid,integer,integer,text,boolean),private.enterprise_valid_now(jsonb),private.enterprise_member(jsonb),private.enterprise_allowed(uuid,text,text,text,uuid),private.enterprise_master_access(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.enterprise_master_access(uuid,text,uuid) to authenticated;
revoke all on function public.enterprise_access_publication(uuid),public.enterprise_publish_access_policy(uuid,integer,integer,text),public.enterprise_revert_access_policy(uuid,integer,text),public.enterprise_access_companies(),public.enterprise_access_context(uuid) from public,anon,authenticated;
grant execute on function public.enterprise_access_publication(uuid),public.enterprise_publish_access_policy(uuid,integer,integer,text),public.enterprise_revert_access_policy(uuid,integer,text),public.enterprise_access_companies(),public.enterprise_access_context(uuid) to authenticated;


-- Recovery metadata, separate from published business row access.
create function public.enterprise_access_sites(target_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(private.is_admin(),false) then raise exception 'access_denied' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'companyId',s.company_id) order by s.name,s.id),'[]'::jsonb) from public.sites s join public.companies c on c.id=s.company_id where s.company_id=target_company);
end; $$;
revoke all on function public.enterprise_access_sites(uuid) from public,anon,authenticated;
grant execute on function public.enterprise_access_sites(uuid) to authenticated;
alter function public.enterprise_access_sites(uuid) owner to postgres;
alter function public.enterprise_access_publication(uuid) owner to postgres;
alter function public.enterprise_publish_access_policy(uuid,integer,integer,text) owner to postgres;
alter function public.enterprise_revert_access_policy(uuid,integer,text) owner to postgres;
alter function public.enterprise_access_companies() owner to postgres;
alter function public.enterprise_access_context(uuid) owner to postgres;
alter function private.enterprise_publish(uuid,integer,integer,text,boolean) owner to postgres;
alter function private.enterprise_member(jsonb) owner to postgres;
alter function private.enterprise_allowed(uuid,text,text,text,uuid) owner to postgres;
alter function private.enterprise_master_access(uuid,text,uuid) owner to postgres;


-- Allow administrators to repair drafts for inactive companies without bypassing business grants.
create or replace function public.enterprise_save_access_policy(target_company uuid, policy_document jsonb, expected_revision integer, change_reason text)
returns table(policy jsonb, revision integer)
language plpgsql security definer set search_path = '' as $$
declare
 item jsonb; permission_item jsonb; actor jsonb; section text; current_policy jsonb; current_revision integer; next_revision integer;
begin
 if not coalesce(private.is_admin(), false) then raise exception 'access_denied' using errcode = '42501'; end if;
 -- Lock company even on first insert, preventing concurrent revision-zero creation.
 perform 1 from public.companies where id = target_company for update;
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
   if nullif(item->>'siteId','') is not null and not exists(select 1 from public.sites site where site.id = (item->>'siteId')::uuid and site.company_id = target_company ) then raise exception 'invalid_policy' using errcode = '22023'; end if;
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
