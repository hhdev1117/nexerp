-- Run with the local Supabase stack and `npx supabase test db`.
begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.infrastructure_database_size()'::regprocedure), 'database size RPC runs as its owner');
select ok((select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid = 'public.infrastructure_database_size()'::regprocedure), 'database size RPC has an empty search path');
select ok(not exists (
    select 1
    from pg_catalog.pg_proc as function
    cross join lateral pg_catalog.aclexplode(coalesce(function.proacl, pg_catalog.acldefault('f', function.proowner))) as privilege
    where function.oid = 'public.infrastructure_database_size()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
), 'PUBLIC has no execution privilege');

select ok(not pg_catalog.has_function_privilege('anon', 'public.infrastructure_database_size()', 'EXECUTE'), 'anonymous callers cannot read cluster database size');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.infrastructure_database_size()', 'EXECUTE'), 'authenticated callers cannot read cluster database size');
select ok(pg_catalog.has_function_privilege('service_role', 'public.infrastructure_database_size()', 'EXECUTE'), 'service role can read cluster database size');

set local role anon;
select throws_ok(
    $$select public.infrastructure_database_size()$$,
    '42501',
    'permission denied for function infrastructure_database_size',
    'anonymous RPC execution is denied'
);
reset role;

set local role authenticated;
select throws_ok(
    $$select public.infrastructure_database_size()$$,
    '42501',
    'permission denied for function infrastructure_database_size',
    'authenticated RPC execution is denied'
);
reset role;

set local role service_role;
select ok(public.infrastructure_database_size() > 0, 'service role receives an actual database byte count');
reset role;

select * from finish();
rollback;
