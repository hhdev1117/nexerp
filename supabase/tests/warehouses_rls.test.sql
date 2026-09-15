-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('a0000000-0000-0000-0000-000000000001', 'warehouse-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('a0000000-0000-0000-0000-000000000002', 'warehouse-member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = 'a0000000-0000-0000-0000-000000000001'::uuid;

insert into public.companies (id, code, name)
values
    ('a1000000-0000-0000-0000-000000000001', 'WHM', '창고 회사'),
    ('a1000000-0000-0000-0000-000000000002', 'WHX', '다른 회사');

insert into public.sites (id, company_id, code, name, site_type)
values
    ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'ICN', '인천 공장', 'factory'),
    ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'BSN', '부산 물류센터', 'warehouse');

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.warehouses'::regclass),
    'warehouses has row-level security enabled'
);

select ok(not pg_catalog.has_table_privilege('anon', 'public.warehouses', 'SELECT'), 'anonymous clients have no select grant on warehouses');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.warehouses', 'DELETE'), 'authenticated clients have no delete grant on warehouses');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$insert into public.warehouses (id, company_id, site_id, code, name, warehouse_type)
      values ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'WH-ICN-RM', '인천 원자재창고', 'raw_material')$$,
    'an administrator registers a warehouse'
);

select results_eq(
    $$select code, warehouse_type::text, is_active, created_by from public.warehouses$$,
    $$values ('WH-ICN-RM'::text, 'raw_material'::text, true, 'a0000000-0000-0000-0000-000000000001'::uuid)$$,
    'the stored warehouse keeps its values and records the caller'
);

select results_eq(
    $$select action::text, company_id from public.audit_logs where table_name = 'warehouses' order by id$$,
    $$values ('insert'::text, 'a1000000-0000-0000-0000-000000000001'::uuid)$$,
    'the shared change ledger records the new warehouse'
);

select throws_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'WH-ICN-RM', '중복 코드')$$,
    '23505',
    null,
    'warehouse codes are unique within a company'
);

select throws_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'WH-X', '회사 불일치')$$,
    '22023',
    'site_company_mismatch',
    'a warehouse cannot point at a site of another company'
);

select throws_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000ff', 'WH-X', '없는 사업장')$$,
    '22023',
    'site_not_found',
    'the before-trigger reports a missing site ahead of the foreign key'
);

select throws_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'wh-lower', '형식 오류')$$,
    '23514',
    null,
    'warehouse codes must be upper-case alphanumerics'
);

select lives_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'WH-ICN-RM', '다른 회사 동일 코드')$$,
    'the same warehouse code may exist under a different company'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
    $$insert into public.warehouses (company_id, site_id, code, name)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'WH-USR', '일반 사용자 창고')$$,
    '42501',
    'new row violates row-level security policy for table "warehouses"',
    'an ordinary user cannot insert warehouses'
);

select throws_ok(
    $$delete from public.warehouses where code = 'WH-ICN-RM'$$,
    '42501',
    'permission denied for table warehouses',
    'an ordinary user cannot delete warehouses'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$update public.sites set is_active = false where id = 'a2000000-0000-0000-0000-000000000001'$$,
    'an administrator deactivates a site'
);

select results_eq(
    $$select count(*) from public.warehouses where site_id = 'a2000000-0000-0000-0000-000000000001' and is_active$$,
    $$values (0::bigint)$$,
    'deactivating a site deactivates the warehouses inside it'
);

select throws_ok(
    $$update public.warehouses set is_active = true where id = 'a3000000-0000-0000-0000-000000000001'$$,
    '22023',
    'site_inactive',
    'a warehouse cannot be revived while its site is inactive'
);

select lives_ok(
    $$insert into public.warehouses (company_id, site_id, code, name, is_active)
      values ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'WH-ARC', '보관용 창고', false)$$,
    'an inactive warehouse may be recorded under an inactive site'
);

select results_eq(
    $$select (old_data ->> 'is_active')::boolean, (new_data ->> 'is_active')::boolean
      from public.audit_logs where table_name = 'warehouses' and action = 'update' order by id$$,
    $$values (true, false)$$,
    'the cascade that deactivates warehouses is recorded'
);

reset role;

select * from finish();
rollback;
