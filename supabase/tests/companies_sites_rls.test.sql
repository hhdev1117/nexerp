-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('30000000-0000-0000-0000-000000000001', 'member@nexerp.internal', '{}'::jsonb, '{"login_id":"member","nexerp_provisioned":true}'::jsonb),
    ('30000000-0000-0000-0000-000000000002', 'adminuser@nexerp.internal', '{}'::jsonb, '{"login_id":"adminuser","nexerp_provisioned":true}'::jsonb),
    ('30000000-0000-0000-0000-000000000003', 'inactive@nexerp.internal', '{}'::jsonb, '{"login_id":"inactive","nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '30000000-0000-0000-0000-000000000002'::uuid;

update public.profiles
set is_active = false
where id = '30000000-0000-0000-0000-000000000003'::uuid;

insert into public.companies (id, code, name, business_number)
values ('40000000-0000-0000-0000-000000000001', 'NXM', '넥서스 제조', '1208812345');

insert into public.sites (id, company_id, code, name, site_type)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'HQ', '서울 본사', 'head_office');

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.companies'::regclass),
    'companies has row-level security enabled'
);

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.sites'::regclass),
    'sites has row-level security enabled'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.companies', 'SELECT'),
    'anonymous clients have no select grant on companies'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.sites', 'SELECT'),
    'anonymous clients have no select grant on sites'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.companies', 'DELETE'),
    'authenticated clients have no delete grant on companies'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.sites', 'DELETE'),
    'authenticated clients have no delete grant on sites'
);

select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select id from public.companies$$,
    'an AAL1 user cannot read companies'
);

select is_empty(
    $$select id from public.sites$$,
    'an AAL1 user cannot read sites'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
    $$select code from public.companies order by code$$,
    $$values ('NXM'::text)$$,
    'an AAL2 active user reads companies'
);

select results_eq(
    $$select code from public.sites order by code$$,
    $$values ('HQ'::text)$$,
    'an AAL2 active user reads sites'
);

select throws_ok(
    $$insert into public.companies (code, name) values ('USR', '사용자 회사')$$,
    '42501',
    'new row violates row-level security policy for table "companies"',
    'an ordinary user cannot insert companies'
);

select throws_ok(
    $$insert into public.sites (company_id, code, name) values ('40000000-0000-0000-0000-000000000001', 'USR', '사용자 사업장')$$,
    '42501',
    'new row violates row-level security policy for table "sites"',
    'an ordinary user cannot insert sites'
);

select lives_ok(
    $$update public.companies set name = '변경 시도' where code = 'NXM'$$,
    'an ordinary user update is filtered by row-level security instead of raising'
);

select throws_ok(
    $$delete from public.companies where code = 'NXM'$$,
    '42501',
    'permission denied for table companies',
    'an ordinary user cannot delete companies'
);

reset role;

select results_eq(
    $$select name from public.companies where code = 'NXM'$$,
    $$values ('넥서스 제조'::text)$$,
    'the filtered update changed nothing'
);

select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000003","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is_empty(
    $$select id from public.companies$$,
    'an inactive user cannot read companies'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
    $$select id from public.companies$$,
    'an AAL1 administrator cannot read companies'
);

select throws_ok(
    $$insert into public.companies (code, name) values ('NXD', '넥서스 유통')$$,
    '42501',
    'new row violates row-level security policy for table "companies"',
    'an AAL1 administrator cannot insert companies'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok(
    $$insert into public.companies (id, code, name, business_number, created_by, updated_by)
      values ('40000000-0000-0000-0000-000000000002', 'NXD', '넥서스 유통', '2148867890', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')$$,
    'an AAL2 administrator inserts a company'
);

select results_eq(
    $$select created_by, updated_by from public.companies where code = 'NXD'$$,
    $$values ('30000000-0000-0000-0000-000000000002'::uuid, '30000000-0000-0000-0000-000000000002'::uuid)$$,
    'audit columns record the caller instead of the supplied values'
);

select throws_ok(
    $$insert into public.companies (code, name) values ('NXD', '중복 회사')$$,
    '23505',
    null,
    'company codes are unique'
);

select throws_ok(
    $$insert into public.companies (code, name, business_number) values ('NXX', '중복 사업자', '2148867890')$$,
    '23505',
    null,
    'business registration numbers are unique'
);

select throws_ok(
    $$insert into public.companies (code, name) values ('nxd-lower', '형식 오류')$$,
    '23514',
    null,
    'company codes must be upper-case alphanumerics'
);

select throws_ok(
    $$insert into public.companies (code, name, business_number) values ('NXB', '번호 오류', '12-34')$$,
    '23514',
    null,
    'business registration numbers must be ten digits'
);

select lives_ok(
    $$insert into public.sites (id, company_id, code, name, site_type)
      values ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'BSN', '부산 물류센터', 'warehouse')$$,
    'an administrator inserts a site under an active company'
);

select throws_ok(
    $$insert into public.sites (company_id, code, name) values ('40000000-0000-0000-0000-000000000002', 'BSN', '중복 사업장')$$,
    '23505',
    null,
    'site codes are unique within a company'
);

select lives_ok(
    $$insert into public.sites (company_id, code, name) values ('40000000-0000-0000-0000-000000000001', 'BSN', '다른 회사 동일 코드')$$,
    'the same site code may exist under a different company'
);

select lives_ok(
    $$update public.companies set name = '넥서스 유통 주식회사' where code = 'NXD'$$,
    'an administrator updates a company'
);

select results_eq(
    $$select name, updated_by from public.companies where code = 'NXD'$$,
    $$values ('넥서스 유통 주식회사'::text, '30000000-0000-0000-0000-000000000002'::uuid)$$,
    'company updates persist and stamp the caller'
);

select lives_ok(
    $$update public.companies set is_active = false where code = 'NXD'$$,
    'an administrator deactivates a company'
);

select results_eq(
    $$select count(*) from public.sites where company_id = '40000000-0000-0000-0000-000000000002' and is_active$$,
    $$values (0::bigint)$$,
    'deactivating a company deactivates its sites'
);

select throws_ok(
    $$insert into public.sites (company_id, code, name) values ('40000000-0000-0000-0000-000000000002', 'NEW', '비활성 회사 사업장')$$,
    '22023',
    'company_inactive',
    'an active site cannot be created under an inactive company'
);

select throws_ok(
    $$update public.sites set is_active = true where id = '50000000-0000-0000-0000-000000000002'$$,
    '22023',
    'company_inactive',
    'a site cannot be reactivated while its company is inactive'
);

select lives_ok(
    $$insert into public.sites (company_id, code, name, is_active) values ('40000000-0000-0000-0000-000000000002', 'ARC', '보관용 사업장', false)$$,
    'an inactive site may be recorded under an inactive company'
);

select throws_ok(
    $$delete from public.sites where id = '50000000-0000-0000-0000-000000000002'$$,
    '42501',
    'permission denied for table sites',
    'an administrator also cannot delete sites; deactivate instead'
);

reset role;

select * from finish();
rollback;
