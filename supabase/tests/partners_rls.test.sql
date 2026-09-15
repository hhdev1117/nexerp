-- Requires `npx supabase start`; migrations are applied before this pgTAP file.
begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('83000000-0000-4000-8000-000000000001', 'partner-user@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('83000000-0000-4000-8000-000000000002', 'partner-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('83000000-0000-4000-8000-000000000003', 'partner-inactive@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);
update public.profiles set role = 'admin'::public.app_role where id = '83000000-0000-4000-8000-000000000002';
update public.profiles set is_active = false where id = '83000000-0000-4000-8000-000000000003';
insert into public.companies (id, code, name, is_active)
values
    ('84000000-0000-4000-8000-000000000001', 'PRT', '거래처 테스트 회사', true),
    ('84000000-0000-4000-8000-000000000002', 'OFF', '비활성 회사', false);
insert into public.partners (id, company_id, code, name, is_customer)
values ('85000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'BASE', '기존 거래처', true);

select has_table('public', 'partners', 'partners table exists');
select has_column('public', 'partners', 'company_id', 'company scope is stored');
select has_column('public', 'partners', 'code', 'partner code is stored');
select has_column('public', 'partners', 'name', 'partner name is stored');
select has_column('public', 'partners', 'business_number', 'business number is stored');
select has_column('public', 'partners', 'is_customer', 'customer role is stored');
select has_column('public', 'partners', 'is_vendor', 'vendor role is stored');
select has_column('public', 'partners', 'payment_terms_days', 'payment terms are stored');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.partners'::regclass), 'partners has RLS');
select ok(not has_table_privilege('anon', 'public.partners', 'SELECT'), 'anonymous clients cannot read partners');
select ok(not has_table_privilege('authenticated', 'public.partners', 'DELETE'), 'authenticated clients cannot delete partners');
select ok(has_table_privilege('authenticated', 'public.partners', 'SELECT'), 'authenticated clients receive select');
select ok(has_table_privilege('authenticated', 'public.partners', 'INSERT'), 'authenticated clients receive insert through RLS');
select ok(has_table_privilege('authenticated', 'public.partners', 'UPDATE'), 'authenticated clients receive update through RLS');
select is((select count(*)::integer from pg_catalog.pg_policy where polrelid = 'public.partners'::regclass), 3, 'partners has three policies');
select has_constraint('public', 'partners', 'partners_company_code_key', 'company and code are unique');
select has_constraint('public', 'partners', 'partners_role_required', 'at least one partner role is required');
select has_index('public', 'partners', 'partners_company_business_number_key', 'business number has a partial unique index');
select has_trigger('public', 'partners', 'set_partners_audit_columns', 'audit trigger exists');
select has_trigger('public', 'partners', 'enforce_partner_company_active', 'active-company trigger exists');
select ok((select allowed_menu_keys @> array['master.partners'] from public.role_menu_permissions where role = 'admin'), 'administrator menu includes unified partners');
select ok(not exists(select 1 from public.role_menu_permissions where allowed_menu_keys && array['sales.customers','purchasing.vendors']), 'legacy partner menu keys are removed');

select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq($$select code from public.partners order by code$$, $$values ('BASE'::text)$$, 'an active AAL2 user reads partners');
select throws_ok($$insert into public.partners(company_id,code,name,is_customer) values('84000000-0000-4000-8000-000000000001','DENY','거부',true)$$, '42501', null, 'an ordinary user cannot insert partners');

reset role;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000003","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is_empty($$select id from public.partners$$, 'an inactive user cannot read partners');

reset role;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is_empty($$select id from public.partners$$, 'an AAL1 administrator cannot read partners');

reset role;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok($$insert into public.partners(company_id,code,name,is_customer,is_vendor,business_number,created_by,updated_by) values('84000000-0000-4000-8000-000000000001','DUAL','통합 거래처',true,true,'1208812345','83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')$$, 'an administrator inserts a dual-role partner');
select results_eq($$select created_by,updated_by from public.partners where code='DUAL'$$, $$values ('83000000-0000-4000-8000-000000000002'::uuid,'83000000-0000-4000-8000-000000000002'::uuid)$$, 'audit columns record the caller');
select throws_ok($$insert into public.partners(company_id,code,name,is_customer) values('84000000-0000-4000-8000-000000000001','DUAL','중복 코드',true)$$, '23505', null, 'partner codes are unique within a company');
select throws_ok($$insert into public.partners(company_id,code,name,is_vendor,business_number) values('84000000-0000-4000-8000-000000000001','BIZ2','중복 번호',true,'1208812345')$$, '23505', null, 'business numbers are unique within a company');
select throws_ok($$insert into public.partners(company_id,code,name) values('84000000-0000-4000-8000-000000000001','NOROLE','역할 없음')$$, '23514', null, 'a partner needs a customer or vendor role');
select throws_ok($$insert into public.partners(company_id,code,name,is_customer) values('84000000-0000-4000-8000-000000000001','lower','코드 오류',true)$$, '23514', null, 'partner codes use the required format');
select throws_ok($$insert into public.partners(company_id,code,name,is_customer,business_number) values('84000000-0000-4000-8000-000000000001','BADBIZ','번호 오류',true,'12-34')$$, '23514', null, 'business numbers contain ten digits');
select throws_ok($$insert into public.partners(company_id,code,name,is_customer) values('84000000-0000-4000-8000-000000000002','OFFP','비활성 회사 거래처',true)$$, '22023', 'company_inactive', 'active partners cannot be created under inactive companies');
select results_eq($$update public.partners set name='변경 거래처',updated_by='83000000-0000-4000-8000-000000000001' where code='DUAL' returning name,updated_by$$, $$values ('변경 거래처'::text,'83000000-0000-4000-8000-000000000002'::uuid)$$, 'administrator update refreshes audit ownership');

reset role;
select * from finish();
rollback;
