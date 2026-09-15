-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('a1000000-0000-0000-0000-000000000001', 'preferences-one@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('a1000000-0000-0000-0000-000000000002', 'preferences-two@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('a1000000-0000-0000-0000-000000000003', 'preferences-inactive@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

select results_eq(
    $$select ui_preferences from public.profiles where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    $$values ('{}'::jsonb)$$,
    'new profiles start with empty UI preferences'
);

select throws_ok(
    $$update public.profiles set ui_preferences = '[]'::jsonb where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    '23514',
    null,
    'UI preferences reject JSON arrays'
);

select throws_ok(
    $$update public.profiles set ui_preferences = null where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    '23502',
    null,
    'UI preferences reject null'
);

select ok(
    pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'ui_preferences', 'UPDATE'),
    'authenticated clients may update the UI preferences column'
);

select ok(
    not pg_catalog.has_column_privilege('anon', 'public.profiles', 'ui_preferences', 'UPDATE'),
    'anonymous clients cannot update the UI preferences column'
);

select ok(
    not pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
    'the UI preferences grant does not expose protected profile columns'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
    'authenticated clients have no delete grant on profiles'
);

select results_eq(
    $$select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'$$,
    $$values (1::bigint)$$,
    'profiles retain exactly one update policy'
);

select results_eq(
    $$select policyname from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'$$,
    $$values ('Active users update their profile'::name)$$,
    'UI preferences reuse the existing active-user self-update policy'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
    $$update public.profiles set ui_preferences = '{"darkTheme":true,"menuMode":"static"}'::jsonb where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    'an active user can update their own UI preferences'
);

select results_eq(
    $$select ui_preferences from public.profiles$$,
    $$values ('{"darkTheme":true,"menuMode":"static"}'::jsonb)$$,
    'the active user reads back their saved UI preferences'
);

select lives_ok(
    $$update public.profiles set ui_preferences = '{"darkTheme":true}'::jsonb where id = 'a1000000-0000-0000-0000-000000000002'::uuid$$,
    'an update targeting another profile is filtered by row-level security'
);

select throws_ok(
    $$update public.profiles set role = 'admin'::public.app_role where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    '42501',
    'permission denied for table profiles',
    'the new column grant cannot be used to escalate a role'
);

select throws_ok(
    $$delete from public.profiles where id = 'a1000000-0000-0000-0000-000000000001'::uuid$$,
    '42501',
    'permission denied for table profiles',
    'an authenticated user cannot delete their profile'
);

reset role;

select results_eq(
    $$select ui_preferences from public.profiles where id = 'a1000000-0000-0000-0000-000000000002'::uuid$$,
    $$values ('{}'::jsonb)$$,
    'one user cannot change another account preferences'
);

update public.profiles
set is_active = false
where id = 'a1000000-0000-0000-0000-000000000003'::uuid;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select lives_ok(
    $$update public.profiles set ui_preferences = '{"darkTheme":true}'::jsonb where id = 'a1000000-0000-0000-0000-000000000003'::uuid$$,
    'an inactive user update is filtered by the existing policy'
);

reset role;

select results_eq(
    $$select ui_preferences from public.profiles where id = 'a1000000-0000-0000-0000-000000000003'::uuid$$,
    $$values ('{}'::jsonb)$$,
    'an inactive user cannot change their stored preferences'
);

select * from finish();
rollback;
