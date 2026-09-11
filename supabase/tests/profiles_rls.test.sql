-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
    ('10000000-0000-0000-0000-000000000001', 'user-one@example.test', '{"role":"admin","is_active":false}'::jsonb),
    ('10000000-0000-0000-0000-000000000002', 'user-two@example.test', '{}'::jsonb),
    ('10000000-0000-0000-0000-000000000003', 'admin@example.test', '{}'::jsonb);

select hasnt_table_privilege(
    'anon',
    'public',
    'profiles',
    'select',
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

reset role;
update public.profiles
set role = 'admin'::public.app_role
where id = '10000000-0000-0000-0000-000000000003'::uuid;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.profiles$$,
    $$values (3::bigint)$$,
    'an active administrator can read every profile'
);

reset role;
update public.profiles
set is_active = false
where id = '10000000-0000-0000-0000-000000000001'::uuid;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select id from public.profiles$$,
    'an inactive user cannot read their own profile'
);

select * from finish();
rollback;
