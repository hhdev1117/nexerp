-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('31000000-0000-0000-0000-000000000001', 'partner-member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('31000000-0000-0000-0000-000000000002', 'partner-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('31000000-0000-0000-0000-000000000003', 'partner-inactive@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '31000000-0000-0000-0000-000000000002'::uuid;

update public.profiles
set is_active = false
where id = '31000000-0000-0000-0000-000000000003'::uuid;

insert into public.companies (id, code, name, is_active)
values
    ('41000000-0000-0000-0000-000000000001', 'PRTA', 'Partner Company A', true),
    ('41000000-0000-0000-0000-000000000002', 'PRTB', 'Partner Company B', true),
    ('41000000-0000-0000-0000-000000000003', 'PRTX', 'Inactive Partner Company', false);

insert into public.partners (id, company_id, code, name, business_number, is_customer)
values (
    '51000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001',
    'SEED',
    'Seed Partner',
    '1208812345',
    true
);

select ok(
    pg_catalog.to_regclass('public.partners') is not null,
    'partners table exists'
);

select results_eq(
    $$select column_name::text
      from information_schema.columns
      where table_schema = 'public' and table_name = 'partners'
      order by ordinal_position$$,
    $$values
        ('id'::text),
        ('company_id'::text),
        ('code'::text),
        ('name'::text),
        ('business_number'::text),
        ('is_customer'::text),
        ('is_vendor'::text),
        ('representative'::text),
        ('email'::text),
        ('phone'::text),
        ('address'::text),
        ('is_active'::text),
        ('created_at'::text),
        ('updated_at'::text),
        ('created_by'::text),
        ('updated_by'::text)$$,
    'partners exposes the expected columns in order'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.partners'::regclass
          and conname = 'partners_company_id_fkey'
          and contype = 'f'
    ),
    'partners company ownership is protected by a foreign key'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.partners'::regclass
          and conname = 'partners_company_code_key'
          and contype = 'u'
    ),
    'partner codes have a company-scoped unique constraint'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'partners'
          and indexname = 'partners_company_business_number_key'
          and indexdef ilike '%unique%'
          and indexdef ilike '%where%business_number%is not null%'
    ),
    'partner business numbers have a partial company-scoped unique index'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'partners'
          and indexname = 'partners_company_id_idx'
    ),
    'partners has a company lookup index'
);

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.partners'::regclass),
    'partners has row-level security enabled'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.partners', 'SELECT'),
    'anonymous clients have no select grant on partners'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.partners', 'DELETE'),
    'authenticated clients have no delete grant on partners'
);

select results_eq(
    $$select count(*)::bigint from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'partners'$$,
    $$values (3::bigint)$$,
    'partners has exactly three RLS policies'
);

select results_eq(
    $$select role::text
      from public.role_menu_permissions
      where 'master.partners' = any (allowed_menu_keys)
      order by role::text$$,
    $$values ('admin'::text), ('approver'::text), ('user'::text)$$,
    'all legacy partner grants are represented by master.partners'
);

select ok(
    not exists (
        select 1
        from public.role_menu_permissions
        where 'sales.customers' = any (allowed_menu_keys)
    ),
    'sales.customers is removed from saved permissions'
);

select ok(
    not exists (
        select 1
        from public.role_menu_permissions
        where 'purchasing.vendors' = any (allowed_menu_keys)
    ),
    'purchasing.vendors is removed from saved permissions'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select id from public.partners$$,
    'an AAL1 user cannot read partners'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'AAL1', 'AAL1 Partner', true)$$,
    '42501',
    'new row violates row-level security policy for table "partners"',
    'an AAL1 user cannot insert partners'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
    $$select code from public.partners order by code$$,
    $$values ('SEED'::text)$$,
    'an active AAL2 user reads partners'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_vendor)
      values ('41000000-0000-0000-0000-000000000001', 'MEMBER', 'Member Partner', true)$$,
    '42501',
    'new row violates row-level security policy for table "partners"',
    'an ordinary user cannot insert partners'
);

select lives_ok(
    $$update public.partners set name = 'Filtered Update' where code = 'SEED'$$,
    'an ordinary user update is filtered by RLS instead of raising'
);

reset role;

select results_eq(
    $$select name from public.partners where code = 'SEED'$$,
    $$values ('Seed Partner'::text)$$,
    'the filtered partner update changed nothing'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
    $$delete from public.partners where code = 'SEED'$$,
    '42501',
    'permission denied for table partners',
    'an ordinary user cannot delete partners'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000003","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is_empty(
    $$select id from public.partners$$,
    'an inactive user cannot read partners'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000002","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
    $$select id from public.partners$$,
    'an AAL1 administrator cannot read partners'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'ADMIN1', 'AAL1 Admin Partner', true)$$,
    '42501',
    'new row violates row-level security policy for table "partners"',
    'an AAL1 administrator cannot insert partners'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok(
    $$insert into public.partners (
          id, company_id, code, name, business_number, is_vendor, created_by, updated_by
      ) values (
          '51000000-0000-0000-0000-000000000002',
          '41000000-0000-0000-0000-000000000001',
          'VENDOR',
          'Vendor Partner',
          '2148867890',
          true,
          '31000000-0000-0000-0000-000000000001',
          '31000000-0000-0000-0000-000000000001'
      )$$,
    'an AAL2 administrator inserts a partner'
);

select results_eq(
    $$select created_by, updated_by from public.partners where code = 'VENDOR'$$,
    $$values (
        '31000000-0000-0000-0000-000000000002'::uuid,
        '31000000-0000-0000-0000-000000000002'::uuid
    )$$,
    'partner audit columns record the caller instead of supplied values'
);

select lives_ok(
    $$update public.partners set name = 'Updated Vendor Partner' where code = 'VENDOR'$$,
    'an AAL2 administrator updates a partner'
);

select results_eq(
    $$select name, updated_by from public.partners where code = 'VENDOR'$$,
    $$values (
        'Updated Vendor Partner'::text,
        '31000000-0000-0000-0000-000000000002'::uuid
    )$$,
    'partner updates persist and stamp the caller'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'VENDOR', 'Duplicate Code', true)$$,
    '23505',
    null,
    'partner codes are unique within a company'
);

select lives_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000002', 'VENDOR', 'Same Code Other Company', true)$$,
    'the same partner code may exist in another company'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, business_number, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'DUP-BIZ', 'Duplicate Business Number', '2148867890', true)$$,
    '23505',
    null,
    'business numbers are unique within a company'
);

select lives_ok(
    $$insert into public.partners (company_id, code, name, business_number, is_vendor)
      values ('41000000-0000-0000-0000-000000000002', 'SAME-BIZ', 'Same Business Other Company', '2148867890', true)$$,
    'the same business number may exist in another company'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'lower', 'Invalid Code', true)$$,
    '23514',
    null,
    'partner codes must use upper-case alphanumerics and hyphens'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, business_number, is_customer)
      values ('41000000-0000-0000-0000-000000000001', 'BAD-BIZ', 'Invalid Business Number', '12-34', true)$$,
    '23514',
    null,
    'business numbers must be ten digits when supplied'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name)
      values ('41000000-0000-0000-0000-000000000001', 'NO-ROLE', 'Missing Role')$$,
    '23514',
    null,
    'a partner must be a customer, a vendor, or both'
);

select throws_ok(
    $$insert into public.partners (company_id, code, name, is_customer)
      values ('41000000-0000-0000-0000-000000000003', 'INACTIVE', 'Inactive Company Partner', true)$$,
    '22023',
    'company_inactive',
    'an active partner cannot be created under an inactive company'
);

reset role;

select * from finish();
rollback;
