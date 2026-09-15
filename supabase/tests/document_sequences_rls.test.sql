-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('80000000-0000-0000-0000-000000000001', 'numbering-admin@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb),
    ('80000000-0000-0000-0000-000000000002', 'numbering-member@gmail.com', '{}'::jsonb, '{"nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '80000000-0000-0000-0000-000000000001'::uuid;

insert into public.companies (id, code, name)
values
    ('81000000-0000-0000-0000-000000000001', 'SEQ', '채번 회사'),
    ('81000000-0000-0000-0000-000000000002', 'ALT', '다른 회사'),
    ('81000000-0000-0000-0000-000000000003', 'OLD', '폐업 회사');

update public.companies set is_active = false where code = 'OLD';

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.document_sequences'::regclass),
    'document_sequences has row-level security enabled'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.document_sequences', 'SELECT'),
    'anonymous clients have no select grant on document_sequences'
);

select ok(
    pg_catalog.has_table_privilege('authenticated', 'public.document_sequences', 'SELECT'),
    'authenticated clients may select document_sequences'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.document_sequences', 'INSERT'),
    'authenticated clients have no insert grant on document_sequences'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.document_sequences', 'UPDATE'),
    'authenticated clients have no update grant on document_sequences'
);

select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.document_sequences', 'DELETE'),
    'authenticated clients have no delete grant on document_sequences'
);

select is(
    private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, 'SO', '2026-09-15'::date),
    'SO-260915-001',
    'the first number of a period starts at one'
);

select is(
    private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, 'SO', '2026-09-15'::date),
    'SO-260915-002',
    'the counter advances within the same company, type and day'
);

select is(
    private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, 'PO', '2026-09-15'::date),
    'PO-260915-001',
    'each document type keeps its own counter'
);

select is(
    private.next_document_number('81000000-0000-0000-0000-000000000002'::uuid, 'SO', '2026-09-15'::date),
    'SO-260915-001',
    'each company keeps its own counter'
);

select is(
    private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, '  so  ', '2026-09-15'::date),
    'SO-260915-003',
    'document types normalize before the counter is claimed'
);

select results_eq(
    $$select count(*) from public.document_sequences$$,
    $$values (3::bigint)$$,
    'one counter row exists per company, type and period'
);

select throws_ok(
    $$select private.next_document_number(null, 'SO', '2026-09-15'::date)$$,
    '22023',
    'company_required',
    'a number cannot be issued without a company'
);

select throws_ok(
    $$select private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, 'S1', '2026-09-15'::date)$$,
    '22023',
    'invalid_document_type',
    'document types must be two to four upper-case letters'
);

select throws_ok(
    $$select private.next_document_number('81000000-0000-0000-0000-000000000003'::uuid, 'SO', '2026-09-15'::date)$$,
    '22023',
    'company_inactive',
    'an inactive company cannot issue documents'
);

select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
    $$select doc_type from public.document_sequences$$,
    'an ordinary user reads no counters'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select doc_type from public.document_sequences$$,
    'an AAL1 administrator reads no counters'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select isnt_empty(
    $$select doc_type from public.document_sequences$$,
    'an MFA-verified administrator inspects the counters'
);

select throws_ok(
    $$update public.document_sequences set last_number = 0$$,
    '42501',
    'permission denied for table document_sequences',
    'an administrator cannot rewind a counter'
);

select throws_ok(
    $$delete from public.document_sequences$$,
    '42501',
    'permission denied for table document_sequences',
    'an administrator cannot drop a counter'
);

select throws_ok(
    $$select private.next_document_number('81000000-0000-0000-0000-000000000001'::uuid, 'SO', '2026-09-15'::date)$$,
    '42501',
    null,
    'clients cannot burn numbers by calling the issuing function directly'
);

reset role;

select * from finish();
rollback;
