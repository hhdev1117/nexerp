-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('90000000-0000-0000-0000-000000000001', 'item-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('90000000-0000-0000-0000-000000000002', 'item-member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '90000000-0000-0000-0000-000000000001'::uuid;

insert into public.companies (id, code, name)
values
    ('91000000-0000-0000-0000-000000000001', 'ITM', '품목 회사'),
    ('91000000-0000-0000-0000-000000000002', 'ITX', '폐업 예정 회사');

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.items'::regclass),
    'items has row-level security enabled'
);

select ok(not pg_catalog.has_table_privilege('anon', 'public.items', 'SELECT'), 'anonymous clients have no select grant on items');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.items', 'DELETE'), 'authenticated clients have no delete grant on items');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.items', 'SELECT'), 'authenticated clients may select items');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.items', 'INSERT'), 'authenticated clients may insert items');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.items', 'UPDATE'), 'authenticated clients may update items');

select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$insert into public.items (id, company_id, code, name, item_type, unit, safety_stock, standard_price)
      values ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'RM-AL-001', '알루미늄 시트 2T', 'raw_material', 'EA', 120, 15000)$$,
    'an administrator registers an item'
);

select results_eq(
    $$select code, item_type::text, unit, safety_stock, standard_price, is_active from public.items where code = 'RM-AL-001'$$,
    $$values ('RM-AL-001'::text, 'raw_material'::text, 'EA'::text, 120::numeric(18,3), 15000::numeric(18,0), true)$$,
    'the stored item keeps every supplied value'
);

select results_eq(
    $$select created_by, updated_by from public.items where code = 'RM-AL-001'$$,
    $$values ('90000000-0000-0000-0000-000000000001'::uuid, '90000000-0000-0000-0000-000000000001'::uuid)$$,
    'audit columns record the caller'
);

select results_eq(
    $$select action::text, record_id from public.audit_logs where table_name = 'items' order by id$$,
    $$values ('insert'::text, '92000000-0000-0000-0000-000000000001'::text)$$,
    'the shared change ledger records the new item'
);

select throws_ok(
    $$insert into public.items (company_id, code, name) values ('91000000-0000-0000-0000-000000000001', 'RM-AL-001', '중복 코드')$$,
    '23505',
    null,
    'item codes are unique within a company'
);

select lives_ok(
    $$insert into public.items (company_id, code, name) values ('91000000-0000-0000-0000-000000000002', 'RM-AL-001', '다른 회사 동일 코드')$$,
    'the same item code may exist under a different company'
);

select throws_ok(
    $$insert into public.items (company_id, code, name) values ('91000000-0000-0000-0000-000000000001', 'rm-lower', '형식 오류')$$,
    '23514',
    null,
    'item codes must be upper-case alphanumerics'
);

select throws_ok(
    $$insert into public.items (company_id, code, name, unit) values ('91000000-0000-0000-0000-000000000001', 'RM-U1', '단위 오류', 'ea')$$,
    '23514',
    null,
    'units must be short upper-case codes'
);

select throws_ok(
    $$insert into public.items (company_id, code, name, safety_stock) values ('91000000-0000-0000-0000-000000000001', 'RM-S1', '음수 안전재고', -1)$$,
    '23514',
    null,
    'safety stock cannot be negative'
);

select throws_ok(
    $$insert into public.items (company_id, code, name, standard_price) values ('91000000-0000-0000-0000-000000000001', 'RM-P1', '음수 단가', -1)$$,
    '23514',
    null,
    'standard price cannot be negative'
);

select lives_ok(
    $$update public.items set safety_stock = 200 where code = 'RM-AL-001' and company_id = '91000000-0000-0000-0000-000000000001'$$,
    'an administrator updates an item'
);

select results_eq(
    $$select (old_data ->> 'safety_stock')::numeric, (new_data ->> 'safety_stock')::numeric
      from public.audit_logs where table_name = 'items' and action = 'update' order by id$$,
    $$values (120::numeric, 200::numeric)$$,
    'the change ledger keeps both sides of an item update'
);

select lives_ok(
    $$update public.companies set is_active = false where code = 'ITX'$$,
    'an administrator deactivates a company'
);

select throws_ok(
    $$insert into public.items (company_id, code, name) values ('91000000-0000-0000-0000-000000000002', 'RM-NEW', '비활성 회사 품목')$$,
    '22023',
    'company_inactive',
    'an active item cannot be created under an inactive company'
);

select lives_ok(
    $$insert into public.items (company_id, code, name, is_active) values ('91000000-0000-0000-0000-000000000002', 'RM-ARC', '보관용 품목', false)$$,
    'an inactive item may be recorded under an inactive company'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
    $$insert into public.items (company_id, code, name) values ('91000000-0000-0000-0000-000000000001', 'RM-USR', '일반 사용자 품목')$$,
    '42501',
    'new row violates row-level security policy for table "items"',
    'an ordinary user cannot insert items'
);

select lives_ok(
    $$update public.items set name = '변경 시도' where code = 'RM-AL-001'$$,
    'an ordinary user update is filtered by row-level security instead of raising'
);

select throws_ok(
    $$delete from public.items where code = 'RM-AL-001'$$,
    '42501',
    'permission denied for table items',
    'an ordinary user cannot delete items'
);

reset role;

select results_eq(
    $$select name from public.items where code = 'RM-AL-001' and company_id = '91000000-0000-0000-0000-000000000001'$$,
    $$values ('알루미늄 시트 2T'::text)$$,
    'the filtered update changed nothing'
);

select * from finish();
rollback;
