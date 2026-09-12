begin;

create function public.infrastructure_database_size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select sum(pg_catalog.pg_database_size(database.datname))::bigint
    from pg_catalog.pg_database as database;
$$;

alter function public.infrastructure_database_size() owner to postgres;
revoke all on function public.infrastructure_database_size() from public, anon, authenticated;
grant execute on function public.infrastructure_database_size() to service_role;

commit;
