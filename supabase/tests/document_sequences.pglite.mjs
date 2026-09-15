// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const admin = '61000000-0000-0000-0000-000000000001',
    member = '61000000-0000-0000-0000-000000000002',
    company = '62000000-0000-0000-0000-000000000001',
    other = '62000000-0000-0000-0000-000000000002',
    retired = '62000000-0000-0000-0000-000000000003';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create type public.app_role as enum ('admin','approver','user');
create table public.profiles(id uuid primary key,role public.app_role not null default 'user',is_active boolean not null default true);
create function private.is_aal2() returns boolean language sql as $$select current_setting('request.aal',true)='aal2'$$;
create function private.is_admin() returns boolean language sql security definer as $$select coalesce(private.is_aal2() and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active),false)$$;
grant usage on schema auth,private to authenticated;
insert into public.profiles values ('${admin}','admin',true),('${member}','user',true);
set request.jwt.claim.sub='${admin}'; set request.aal='aal2';`);
for (const file of ['20260914000100_add_companies_and_sites.sql', '20260915001300_add_document_sequences.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
let checks = 0;
const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
};
const rejects = async (run, code, message) => {
    await assert.rejects(run, (error) => error.code === code && (!message || error.message === message));
    checks++;
};
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const issue = async (target, type, day = null) => (await rows('select private.next_document_number($1,$2,$3) number', [target, type, day]))[0].number;
const privilege = async (role, name) => (await rows('select pg_catalog.has_table_privilege($1,$2,$3) granted', [role, 'public.document_sequences', name]))[0].granted;

await db.query("insert into public.companies(id,code,name) values($1,'NXM','넥서스 제조'),($2,'NXD','넥서스 유통'),($3,'OLD','폐업 회사')", [company, other, retired]);
await db.query('update public.companies set is_active=false where id=$1', [retired]);

// Counters are internal state: readable for support, never writable from a client.
eq((await rows("select relrowsecurity from pg_catalog.pg_class where oid='public.document_sequences'::regclass"))[0].relrowsecurity, true);
eq(await privilege('authenticated', 'SELECT'), true);
eq(await privilege('authenticated', 'INSERT'), false);
eq(await privilege('authenticated', 'UPDATE'), false);
eq(await privilege('authenticated', 'DELETE'), false);
eq(await privilege('anon', 'SELECT'), false);

// Numbers run in order within a company, document type and day.
eq(await issue(company, 'SO', '2026-09-15'), 'SO-260915-001');
eq(await issue(company, 'SO', '2026-09-15'), 'SO-260915-002');
eq(await issue(company, 'SO', '2026-09-15'), 'SO-260915-003');

// Each document type, day and company keeps its own counter.
eq(await issue(company, 'PO', '2026-09-15'), 'PO-260915-001');
eq(await issue(company, 'SO', '2026-09-16'), 'SO-260916-001');
eq(await issue(other, 'SO', '2026-09-15'), 'SO-260915-001');
eq(await issue(company, 'SO', '2026-09-15'), 'SO-260915-004');

// Lower-case and padded input normalizes to the stored document type.
eq(await issue(company, '  so  ', '2026-09-15'), 'SO-260915-005');
eq((await rows('select pg_catalog.count(*)::int n from public.document_sequences'))[0].n, 4);
eq((await rows("select last_number from public.document_sequences where company_id=$1 and doc_type='SO' and period_key='260915'", [company]))[0].last_number, 5);

// A missing date falls back to the Korean business day rather than the server locale.
const today = (await rows("select pg_catalog.to_char((pg_catalog.now() at time zone 'Asia/Seoul')::date,'YYMMDD') period"))[0].period;
eq(await issue(company, 'GR'), `GR-${today}-001`);

// Past 999 the number widens instead of failing a real business document.
await db.query("update public.document_sequences set last_number=999 where company_id=$1 and doc_type='SO' and period_key='260915'", [company]);
eq(await issue(company, 'SO', '2026-09-15'), 'SO-260915-1000');

// Bad input is refused with stable business codes.
await rejects(() => issue(null, 'SO', '2026-09-15'), '22023', 'company_required');
await rejects(() => issue(company, '', '2026-09-15'), '22023', 'invalid_document_type');
await rejects(() => issue(company, 'S', '2026-09-15'), '22023', 'invalid_document_type');
await rejects(() => issue(company, 'TOOLONG', '2026-09-15'), '22023', 'invalid_document_type');
await rejects(() => issue(company, 'S1', '2026-09-15'), '22023', 'invalid_document_type');
await rejects(() => issue(retired, 'SO', '2026-09-15'), '22023', 'company_inactive');
await rejects(() => issue('62000000-0000-0000-0000-00000000ffff', 'SO', '2026-09-15'), '22023', 'company_inactive');

// Only MFA-verified administrators may inspect the counters, and none of them may change one.
await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.document_sequences'))[0].n, 0);
await db.exec(`reset role;set request.jwt.claim.sub='${admin}';set request.aal='aal1';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.document_sequences'))[0].n, 0);
await db.exec(`reset role;set request.jwt.claim.sub='${admin}';set request.aal='aal2';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.document_sequences'))[0].n, 5);
await rejects(() => db.query('update public.document_sequences set last_number=0'), '42501');
await rejects(() => db.query('delete from public.document_sequences'), '42501');
await rejects(() => db.query("select private.next_document_number($1,'SO','2026-09-15')", [company]), '42501');

console.log(`Document numbering migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
