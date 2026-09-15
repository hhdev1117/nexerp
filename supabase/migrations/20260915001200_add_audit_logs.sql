-- Append-only change ledger shared by every business table. One generic trigger records who
-- changed which row and the values before and after, so adding history to a new table costs a
-- single `create trigger` line. Administrators read the ledger; nobody writes it from a client
-- because the only insert path is the security-definer trigger below.

create type public.audit_action as enum ('insert', 'update', 'delete');
revoke all on type public.audit_action from public;
grant usage on type public.audit_action to authenticated;

-- record_id is text so the ledger accepts any primary-key type a future table may use.
-- company_id is nullable and carries no foreign key: history must survive independently of the
-- rows it describes, and audited rows such as companies themselves have no parent company.
create table public.audit_logs (
    id bigint generated always as identity primary key,
    table_name text not null,
    record_id text not null,
    company_id uuid null,
    action public.audit_action not null,
    actor_id uuid null,
    changed_at timestamptz not null default pg_catalog.clock_timestamp(),
    old_data jsonb null,
    new_data jsonb null,
    constraint audit_logs_table_name_not_blank check (btrim(table_name) <> ''),
    constraint audit_logs_record_id_not_blank check (btrim(record_id) <> ''),
    constraint audit_logs_payload_matches_action check (
        (action = 'insert' and old_data is null and new_data is not null)
        or (action = 'update' and old_data is not null and new_data is not null)
        or (action = 'delete' and old_data is not null and new_data is null)
    )
);

create index audit_logs_changed_at_idx on public.audit_logs (changed_at desc, id desc);
create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id, changed_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, changed_at desc);
create index audit_logs_company_idx on public.audit_logs (company_id, changed_at desc);

alter table public.audit_logs enable row level security;

-- Select only. Without insert, update or delete grants the ledger cannot be amended or erased
-- by any client, including administrators.
revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;

create policy "Administrators read audit logs"
on public.audit_logs
for select
to authenticated
using ((select private.is_admin()));

create function private.record_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous jsonb;
    latest jsonb;
    subject jsonb;
    scope uuid;
begin
    if tg_op <> 'INSERT' then
        previous := pg_catalog.to_jsonb(old);
    end if;

    if tg_op <> 'DELETE' then
        latest := pg_catalog.to_jsonb(new);
    end if;

    -- A re-save that changes nothing adds no history. The audit columns move on every write,
    -- so they are excluded from the comparison; otherwise no update would ever look idempotent.
    if tg_op = 'UPDATE' and (previous - 'updated_at' - 'updated_by') is not distinct from (latest - 'updated_at' - 'updated_by') then
        return null;
    end if;

    subject := coalesce(latest, previous);
    scope := nullif(subject ->> 'company_id', '')::uuid;

    -- Company rows scope themselves; every other audited table carries company_id.
    if scope is null and tg_table_name = 'companies' then
        scope := nullif(subject ->> 'id', '')::uuid;
    end if;

    insert into public.audit_logs (table_name, record_id, company_id, action, actor_id, old_data, new_data)
    values (
        tg_table_name,
        coalesce(subject ->> 'id', ''),
        scope,
        pg_catalog.lower(tg_op)::public.audit_action,
        (select auth.uid()),
        previous,
        latest
    );

    return null;
end;
$$;

alter function private.record_audit() owner to postgres;
revoke execute on function private.record_audit() from public, anon, authenticated;

-- Audit triggers run after the before-triggers that stamp audit columns, so the recorded
-- snapshot is exactly what the table now holds. Add one line here for every new business table.
create trigger record_companies_audit
after insert or update or delete on public.companies
for each row
execute function private.record_audit();

create trigger record_sites_audit
after insert or update or delete on public.sites
for each row
execute function private.record_audit();

create trigger record_partners_audit
after insert or update or delete on public.partners
for each row
execute function private.record_audit();
