-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('70000000-0000-0000-0000-000000000001', 'auditor@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('70000000-0000-0000-0000-000000000002', 'member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '70000000-0000-0000-0000-000000000001'::uuid;

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_logs'::regclass),
    'audit_logs has row-level security enabled'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.audit_logs', 'SELECT'),
    'anonymous clients have no select grant on audit_logs'
);

select ok(
    pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'SELECT'),
    'authenticated clients may select audit_logs'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'),
    'authenticated clients have no insert grant on audit_logs'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'),
    'authenticated clients have no update grant on audit_logs'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
    'authenticated clients have no delete grant on audit_logs'
);

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$insert into public.companies (id, code, name) values ('71000000-0000-0000-0000-000000000001', 'AUD', '감사 대상 회사')$$,
    'an administrator inserts a company'
);

select results_eq(
    $$select table_name, action::text from public.audit_logs order by id$$,
    $$values ('companies'::text, 'insert'::text)$$,
    'the insert is recorded exactly once'
);

select results_eq(
    $$select actor_id, company_id from public.audit_logs order by id limit 1$$,
    $$values ('70000000-0000-0000-0000-000000000001'::uuid, '71000000-0000-0000-0000-000000000001'::uuid)$$,
    'the entry records the caller and scopes a company row to itself'
);

select is(
    (select old_data from public.audit_logs order by id limit 1),
    null::jsonb,
    'an insert entry has no previous snapshot'
);

select is(
    (select new_data ->> 'code' from public.audit_logs order by id limit 1),
    'AUD',
    'an insert entry keeps the stored values'
);

select lives_ok(
    $$update public.companies set name = '감사 대상 주식회사' where code = 'AUD'$$,
    'an administrator updates the company'
);

select results_eq(
    $$select old_data ->> 'name', new_data ->> 'name' from public.audit_logs where action = 'update' order by id$$,
    $$values ('감사 대상 회사'::text, '감사 대상 주식회사'::text)$$,
    'an update entry keeps both sides of the change'
);

select lives_ok(
    $$update public.companies set name = name where code = 'AUD'$$,
    'a re-save with identical values succeeds'
);

select results_eq(
    $$select count(*) from public.audit_logs$$,
    $$values (2::bigint)$$,
    'a re-save that changes nothing adds no history'
);

select lives_ok(
    $$insert into public.sites (id, company_id, code, name)
      values ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'HQ', '본사')$$,
    'an administrator inserts a site'
);

select results_eq(
    $$select record_id, company_id from public.audit_logs where table_name = 'sites' order by id$$,
    $$values ('72000000-0000-0000-0000-000000000001'::text, '71000000-0000-0000-0000-000000000001'::uuid)$$,
    'a site entry inherits the company scope from its own column'
);

select lives_ok(
    $$update public.companies set is_active = false where code = 'AUD'$$,
    'an administrator deactivates the company'
);

select results_eq(
    $$select (old_data ->> 'is_active')::boolean, (new_data ->> 'is_active')::boolean
      from public.audit_logs where table_name = 'sites' and action = 'update' order by id$$,
    $$values (true, false)$$,
    'the cascade that deactivates sites is recorded'
);

select throws_ok(
    $$insert into public.audit_logs (table_name, record_id, action, new_data) values ('companies', 'x', 'insert', '{}'::jsonb)$$,
    '42501',
    'permission denied for table audit_logs',
    'an administrator cannot append to the ledger'
);

select throws_ok(
    $$update public.audit_logs set action = 'delete'$$,
    '42501',
    'permission denied for table audit_logs',
    'an administrator cannot amend the ledger'
);

select throws_ok(
    $$delete from public.audit_logs$$,
    '42501',
    'permission denied for table audit_logs',
    'an administrator cannot erase the ledger'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
    $$select id from public.audit_logs$$,
    'an ordinary user reads no history'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select id from public.audit_logs$$,
    'an AAL1 administrator reads no history'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select isnt_empty(
    $$select id from public.audit_logs$$,
    'an MFA-verified administrator reads history'
);

reset role;

select lives_ok(
    $$delete from public.sites where id = '72000000-0000-0000-0000-000000000001'$$,
    'a privileged maintenance delete stays possible outside the client roles'
);

select results_eq(
    $$select action::text, new_data is null from public.audit_logs where table_name = 'sites' and action = 'delete'$$,
    $$values ('delete'::text, true)$$,
    'a delete entry keeps only the final snapshot'
);

select * from finish();
rollback;
