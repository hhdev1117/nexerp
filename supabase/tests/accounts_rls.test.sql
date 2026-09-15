-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('b0000000-0000-0000-0000-000000000001', 'account-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('b0000000-0000-0000-0000-000000000002', 'account-member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = 'b0000000-0000-0000-0000-000000000001'::uuid;

insert into public.companies (id, code, name) values ('b1000000-0000-0000-0000-000000000001', 'ACC', '회계 회사');

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.accounts'::regclass),
    'accounts has row-level security enabled'
);

select ok(not pg_catalog.has_table_privilege('anon', 'public.accounts', 'SELECT'), 'anonymous clients have no select grant on accounts');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.accounts', 'DELETE'), 'authenticated clients have no delete grant on accounts');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$insert into public.accounts (id, company_id, code, name, account_type, is_postable)
      values ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '100', '자산', 'asset', false)$$,
    'an administrator registers a top-level summary account'
);

select lives_ok(
    $$insert into public.accounts (id, company_id, parent_id, code, name, account_type, is_postable)
      values ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', '110', '유동자산', 'asset', false)$$,
    'a summary account nests under another summary account'
);

select lives_ok(
    $$insert into public.accounts (id, company_id, parent_id, code, name, account_type, is_postable)
      values ('b2000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', '111', '현금및현금성자산', 'asset', true)$$,
    'a postable leaf nests under a summary account'
);

select results_eq(
    $$select code, is_postable from public.accounts order by code$$,
    $$values ('100'::text, false), ('110'::text, false), ('111'::text, true)$$,
    'the chart stores the hierarchy and the postable flag'
);

select results_eq(
    $$select count(*) from public.audit_logs where table_name = 'accounts'$$,
    $$values (3::bigint)$$,
    'the shared change ledger records every new account'
);

select throws_ok(
    $$insert into public.accounts (company_id, code, name, account_type) values ('b1000000-0000-0000-0000-000000000001', '111', '중복', 'asset')$$,
    '23505',
    null,
    'account codes are unique within a company'
);

select throws_ok(
    $$insert into public.accounts (company_id, code, name, account_type) values ('b1000000-0000-0000-0000-000000000001', 'AB1', '문자 코드', 'asset')$$,
    '23514',
    null,
    'account codes must be numeric'
);

select throws_ok(
    $$insert into public.accounts (company_id, code, name, account_type) values ('b1000000-0000-0000-0000-000000000001', '11', '너무 짧음', 'asset')$$,
    '23514',
    null,
    'account codes need at least three digits'
);

select throws_ok(
    $$insert into public.accounts (company_id, parent_id, code, name, account_type)
      values ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', '410', '유형 불일치', 'revenue')$$,
    '22023',
    'parent_type_mismatch',
    'a child keeps the account type of its parent'
);

select throws_ok(
    $$insert into public.accounts (company_id, parent_id, code, name, account_type)
      values ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000003', '112', '전표 계정 하위', 'asset')$$,
    '22023',
    'parent_is_postable',
    'nothing nests under a postable account'
);

select throws_ok(
    $$insert into public.accounts (company_id, parent_id, code, name, account_type)
      values ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000000ff', '113', '없는 부모', 'asset')$$,
    '22023',
    'parent_not_found',
    'the before-trigger reports a missing parent ahead of the foreign key'
);

select throws_ok(
    $$update public.accounts set parent_id = id where code = '110'$$,
    '22023',
    'invalid_parent',
    'an account cannot be its own parent'
);

select throws_ok(
    $$update public.accounts set parent_id = 'b2000000-0000-0000-0000-000000000002' where code = '100'$$,
    '22023',
    'invalid_parent',
    'a loop through a descendant is refused'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
    $$insert into public.accounts (company_id, code, name, account_type) values ('b1000000-0000-0000-0000-000000000001', '999', '일반 사용자', 'expense')$$,
    '42501',
    'new row violates row-level security policy for table "accounts"',
    'an ordinary user cannot insert accounts'
);

select throws_ok(
    $$delete from public.accounts where code = '111'$$,
    '42501',
    'permission denied for table accounts',
    'an ordinary user cannot delete accounts'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$update public.accounts set is_active = false where code = '100'$$,
    'an administrator deactivates a summary account'
);

select results_eq(
    $$select count(*) from public.accounts where is_active$$,
    $$values (0::bigint)$$,
    'deactivating a summary account deactivates every descendant'
);

select throws_ok(
    $$update public.accounts set is_active = true where code = '111'$$,
    '22023',
    'parent_inactive',
    'a child cannot be revived while its parent is inactive'
);

select results_eq(
    $$select count(*) from public.audit_logs where table_name = 'accounts' and action = 'update'$$,
    $$values (3::bigint)$$,
    'the cascade that deactivates descendants is recorded'
);

reset role;

select * from finish();
rollback;
