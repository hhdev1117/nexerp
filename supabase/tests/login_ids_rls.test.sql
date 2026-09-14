-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('20000000-0000-0000-0000-000000000001', 'abc@nexerp.internal', '{"login_id":"abc","nexerp_provisioned":true}'::jsonb)$$,
    '22023',
    'invalid_login_id',
    'an invalid login ID is rejected'
);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('20000000-0000-0000-0000-000000000002', 'other@nexerp.internal', '{"login_id":"validuser","nexerp_provisioned":true}'::jsonb)$$,
    '22023',
    'login_identity_mismatch',
    'an internal email that does not match the login ID is rejected'
);

select throws_ok(
    $$insert into auth.users (id, email, raw_app_meta_data) values ('20000000-0000-0000-0000-000000000003', 'validuser@nexerp.internal', '{"login_id":"validuser"}'::jsonb)$$,
    '42501',
    'provisioning_required',
    'a matching identity without the provisioning marker is rejected'
);

insert into auth.users (id, email, raw_app_meta_data)
values
    ('20000000-0000-0000-0000-000000000004', 'validuser@nexerp.internal', '{"login_id":"validuser","nexerp_provisioned":true}'::jsonb),
    ('20000000-0000-0000-0000-000000000005', 'adminuser@nexerp.internal', '{"login_id":"adminuser","nexerp_provisioned":true}'::jsonb);

select results_eq(
    $$select email, login_id, role from public.profiles where id = '20000000-0000-0000-0000-000000000004'::uuid$$,
    $$values ('validuser@nexerp.internal'::text, 'validuser'::text, 'user'::public.app_role)$$,
    'valid provisioning stores the internal email and login ID as a user'
);

select throws_ok(
    $$insert into public.profiles (id, email, login_id, role) values ('20000000-0000-0000-0000-000000000006', 'duplicate@nexerp.internal', 'validuser', 'user')$$,
    '23505',
    'duplicate key value violates unique constraint "profiles_login_id_key"',
    'duplicate login IDs are rejected'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT'),
    'anonymous clients retain no select grant on profiles'
);

update public.profiles
set role = 'admin'::public.app_role
where id = '20000000-0000-0000-0000-000000000005'::uuid;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000005","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.profiles$$,
    $$values (1::bigint)$$,
    'an AAL1 administrator can read only their own profile'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000005","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.profiles$$,
    $$values (2::bigint)$$,
    'an AAL2 administrator can read every profile'
);

select is(
    (select login_id from public.profiles where id = '20000000-0000-0000-0000-000000000004'::uuid),
    'validuser'::text,
    'AAL2 access exposes the stored login ID'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000004","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
    $$update public.profiles set login_id = 'changeduser' where id = '20000000-0000-0000-0000-000000000004'::uuid$$,
    '42501',
    'permission denied for table profiles',
    'ordinary users cannot change their login ID'
);

select * from finish();
rollback;
