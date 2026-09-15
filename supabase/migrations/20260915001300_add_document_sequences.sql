-- Server-side document numbering shared by every transactional module. Each company keeps one
-- counter per document type and period, so sales orders, purchase orders, receipts, journals and
-- work orders all draw numbers from the same primitive instead of counting rows in the client.
--
-- The counter is claimed with `insert ... on conflict do update ... returning`. A competing
-- transaction blocks on the conflicting row until the first one commits or rolls back, which
-- gives the same guarantee as `select ... for update` while also covering the very first number
-- of a period, when no row exists to lock yet.

create table public.document_sequences (
    company_id uuid not null references public.companies (id) on delete restrict,
    doc_type text not null,
    period_key text not null,
    last_number integer not null default 0,
    updated_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint document_sequences_pkey primary key (company_id, doc_type, period_key),
    constraint document_sequences_doc_type_format check (doc_type ~ '^[A-Z]{2,4}$'),
    constraint document_sequences_period_key_format check (period_key ~ '^[0-9]{6}$'),
    constraint document_sequences_last_number_range check (last_number between 0 and 999999)
);

alter table public.document_sequences enable row level security;

-- Counters are internal state. Administrators may read them for support; nobody writes them
-- directly, because only the security-definer function below issues numbers.
revoke all on table public.document_sequences from public, anon, authenticated;
grant select on table public.document_sequences to authenticated;

create policy "Administrators read document sequences"
on public.document_sequences
for select
to authenticated
using ((select private.is_admin()));

-- Returns the next number for a company, document type and issue date, for example SO-260915-001.
-- Numbers past 999 in a single period simply grow wider rather than failing a business document.
create function private.next_document_number(target_company uuid, doc_type text, issued_on date default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_type text := pg_catalog.upper(pg_catalog.btrim(coalesce(doc_type, '')));
    issue_date date := coalesce(issued_on, (pg_catalog.now() at time zone 'Asia/Seoul')::date);
    period text := pg_catalog.to_char(issue_date, 'YYMMDD');
    next_number integer;
begin
    if target_company is null then
        raise exception using errcode = '22023', message = 'company_required';
    end if;

    if normalized_type !~ '^[A-Z]{2,4}$' then
        raise exception using errcode = '22023', message = 'invalid_document_type';
    end if;

    if not exists (select 1 from public.companies where id = target_company and is_active) then
        raise exception using errcode = '22023', message = 'company_inactive';
    end if;

    insert into public.document_sequences as sequences (company_id, doc_type, period_key, last_number)
    values (target_company, normalized_type, period, 1)
    on conflict on constraint document_sequences_pkey
    do update set last_number = sequences.last_number + 1, updated_at = pg_catalog.clock_timestamp()
    returning sequences.last_number into next_number;

    -- lpad truncates anything longer than its target width, so widen past 999 explicitly.
    return normalized_type || '-' || period || '-' || case when next_number > 999 then next_number::text else pg_catalog.lpad(next_number::text, 3, '0') end;
end;
$$;

alter function private.next_document_number(uuid, text, date) owner to postgres;
revoke all on function private.next_document_number(uuid, text, date) from public, anon, authenticated;
