begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
 ('71000000-0000-0000-0000-000000000001','activation-admin@gmail.com','{}','{"nexerp_provisioned":true}'),
 ('71000000-0000-0000-0000-000000000002','activation-user@gmail.com','{}','{"nexerp_provisioned":true}');
update public.profiles set role='admin' where id='71000000-0000-0000-0000-000000000001';
insert into public.companies(id,code,name) values('72000000-0000-0000-0000-000000000001','ACT','Activation test');
create temporary table activation_draft as select jsonb_build_object(
 'levels',(select jsonb_agg(jsonb_build_object('id',n,'name','Level '||n,'permissions',case when n=1 then '[{"resource":"dashboard","action":"menu","scope":"self"},{"resource":"dashboard","action":"read","scope":"self"}]'::jsonb else '[]'::jsonb end)) from generate_series(1,5)n),
 'members','[{"id":"71000000-0000-0000-0000-000000000002","name":"User","grade":null,"position":null,"level":1,"organizationId":null,"siteId":null,"active":true,"from":null,"to":null}]'::jsonb,
 'mappings','[]'::jsonb,'roles','[]'::jsonb,'overrides','[]'::jsonb) policy;
grant select on activation_draft to authenticated;
select ok(not has_table_privilege('authenticated','public.enterprise_access_publications','UPDATE'),'snapshots immutable to clients');
select ok(not has_function_privilege('anon','public.enterprise_access_context(uuid)','EXECUTE'),'anonymous runtime denied');
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.enterprise_save_access_policy('72000000-0000-0000-0000-000000000001',(select policy from activation_draft),0,'test')$$,'save');
select is(public.enterprise_publish_access_policy('72000000-0000-0000-0000-000000000001',1,0,'activate')->>'revision','1','publish');
select throws_ok($$select public.enterprise_publish_access_policy('72000000-0000-0000-0000-000000000001',1,0,'stale')$$,'40001','revision_conflict','stale publication');
select throws_ok($$select public.enterprise_revert_access_policy('72000000-0000-0000-0000-000000000001',1,'revert')$$,'22023','no_previous_publication','cannot revert to legacy');
select is(public.enterprise_access_context('72000000-0000-0000-0000-000000000001')->>'mode','active','nonmember administrator still active');
select is(public.enterprise_access_context('72000000-0000-0000-0000-000000000001')->'menuKeys','[]'::jsonb,'administrator has no implicit grants');
select is((select count(*)::integer from companies where id='72000000-0000-0000-0000-000000000001'),0,'no implicit admin business read');
select ok(public.enterprise_access_companies() @> '[{"id":"72000000-0000-0000-0000-000000000001"}]'::jsonb,'recovery catalog');
select lives_ok($$select public.enterprise_save_access_policy('72000000-0000-0000-0000-000000000001',jsonb_set((select policy from activation_draft),'{levels,0,permissions}','[]'),1,'draft change')$$,'edit draft');
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000002","aal":"aal2"}',true);
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
select is(public.enterprise_access_context('72000000-0000-0000-0000-000000000001')->'menuKeys','["dashboard"]'::jsonb,'published navigation survives draft edit');
select throws_ok($$select public.enterprise_access_companies()$$,'42501','access_denied','catalog admin only');
select throws_ok($$select public.enterprise_publish_access_policy('72000000-0000-0000-0000-000000000001',2,1,'user')$$,'42501','access_denied','publication admin only');
select is(public.enterprise_access_context('72000000-0000-0000-0000-000000000001')->'companyActions','[]'::jsonb,'dashboard does not grant company writes');
select throws_ok($$select public.enterprise_access_sites('72000000-0000-0000-0000-000000000001')$$,'42501','access_denied','site catalog admin only');
select ok(not has_function_privilege('anon','public.enterprise_access_sites(uuid)','EXECUTE'),'anonymous site catalog denied');
select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000002","aal":"aal1"}',true);
select throws_ok($$select public.enterprise_access_context('72000000-0000-0000-0000-000000000001')$$,'42501','access_denied','MFA checked per call');
select * from finish();
rollback;
