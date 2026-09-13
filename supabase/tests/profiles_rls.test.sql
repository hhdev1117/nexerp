-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('10000000-0000-0000-0000-000000000001', 'USER-ONE@GMAIL.COM', '{"role":"admin","is_active":false}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('10000000-0000-0000-0000-000000000002', 'user-two@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('10000000-0000-0000-0000-000000000003', 'admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

select results_eq(
    $$select email from public.profiles where id = '10000000-0000-0000-0000-000000000001'::uuid$$,
    $$values ('user-one@gmail.com'::text)$$,
    'the signup profile stores a normalized Gmail address'
);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('10000000-0000-0000-0000-000000000004', 'employee@example.test', '{"nexerp_provisioned":true}'::jsonb)$$,
    '22023',
    'gmail_required',
    'a non-Gmail address is rejected even with the provisioning marker'
);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('10000000-0000-0000-0000-000000000005', 'employee@gmail.com', '{}'::jsonb)$$,
    '42501',
    'provisioning_required',
    'a Gmail address without the provisioning marker is rejected'
);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('10000000-0000-0000-0000-000000000006', 'employee@gmail.com', '{"nexerp_provisioned":"true"}'::jsonb)$$,
    '42501',
    'provisioning_required',
    'a JSON string provisioning marker is rejected'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT'),
    'anonymous clients have no select grant on profiles'
);

set local role anon;
select throws_ok(
    $$select * from public.profiles$$,
    '42501',
    'permission denied for table profiles',
    'anonymous clients cannot read profiles'
);
reset role;

select results_eq(
    $$select count(*) from public.profiles where role = 'user'::public.app_role and is_active$$,
    $$values (3::bigint)$$,
    'signup profiles ignore metadata and always start as active users'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
    $$select id from public.profiles$$,
    $$values ('10000000-0000-0000-0000-000000000001'::uuid)$$,
    'an active user can read their own profile'
);

select is_empty(
    $$select id from public.profiles where id = '10000000-0000-0000-0000-000000000002'::uuid$$,
    'an ordinary user cannot read another profile'
);

select lives_ok(
    $$update public.profiles set display_name = 'User One', department = 'Sales' where id = '10000000-0000-0000-0000-000000000001'::uuid$$,
    'an active user can update their own display fields'
);

select results_eq(
    $$select display_name, department from public.profiles$$,
    $$values ('User One'::text, 'Sales'::text)$$,
    'the permitted display fields are updated'
);

select throws_ok(
    $$update public.profiles set role = 'admin' where id = '10000000-0000-0000-0000-000000000001'::uuid$$,
    '42501',
    'permission denied for table profiles',
    'an ordinary user cannot escalate their role'
);

select throws_ok(
    $$update public.profiles set is_active = false where id = '10000000-0000-0000-0000-000000000001'::uuid$$,
    '42501',
    'permission denied for table profiles',
    'an ordinary user cannot deactivate their profile directly'
);

reset role;
update public.profiles
set role = 'admin'::public.app_role
where id = '10000000-0000-0000-0000-000000000003'::uuid;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.profiles$$,
    $$values (1::bigint)$$,
    'an AAL1 administrator can read only their own profile'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.profiles$$,
    $$values (3::bigint)$$,
    'an AAL2 administrator can read every profile'
);

reset role;
update public.profiles
set is_active = false
where id = '10000000-0000-0000-0000-000000000001'::uuid;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select id from public.profiles$$,
    'an inactive user cannot read their own profile'
);

select * from finish();
rollback;
