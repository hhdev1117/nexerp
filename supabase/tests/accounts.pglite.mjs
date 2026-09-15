// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const admin = '61000000-0000-0000-0000-000000000001',
    member = '61000000-0000-0000-0000-000000000002',
    company = '62000000-0000-0000-0000-000000000001',
    other = '62000000-0000-0000-0000-000000000002';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create type public.app_role as enum ('admin','approver','user');
create table public.profiles(id uuid primary key,role public.app_role not null default 'user',is_active boolean not null default true);
create function private.is_aal2() returns boolean language sql as $$select current_setting('request.aal',true)='aal2'$$;
create function private.is_admin() returns boolean language sql security definer as $$select coalesce(private.is_aal2() and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active),false)$$;
create table public.role_menu_permissions(role public.app_role primary key,allowed_menu_keys text[] not null default '{}',revision integer not null default 1);
create function public.keep_role_menu_permissions() returns trigger language plpgsql as $$begin return new; end;$$;
create trigger protect_admin_role_menu_permissions before update on public.role_menu_permissions for each row execute function public.keep_role_menu_permissions();
grant usage on schema auth,private to authenticated;
insert into public.profiles values ('${admin}','admin',true),('${member}','user',true);
set request.jwt.claim.sub='${admin}'; set request.aal='aal2';`);
for (const file of ['20260914000100_add_companies_and_sites.sql', '20260914000200_add_partners.sql', '20260915001200_add_audit_logs.sql', '20260916001600_add_accounts.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
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
const privilege = async (role, name) => (await rows('select pg_catalog.has_table_privilege($1,$2,$3) granted', [role, 'public.accounts', name]))[0].granted;
const add = (id, code, name, type, parent, postable = true, active = true) =>
    db.query('insert into public.accounts(id,company_id,parent_id,code,name,account_type,is_postable,is_active) values($1,$2,$3,$4,$5,$6,$7,$8)', [id, company, parent, code, name, type, postable, active]);
const activeCount = async () => (await rows('select pg_catalog.count(*)::int n from public.accounts where is_active'))[0].n;

const assets = '67000000-0000-0000-0000-000000000001',
    current = '67000000-0000-0000-0000-000000000002',
    cash = '67000000-0000-0000-0000-000000000003',
    revenue = '67000000-0000-0000-0000-000000000004';

await db.query("insert into public.companies(id,code,name) values($1,'NXM','넥서스 제조'),($2,'NXD','넥서스 유통')", [company, other]);

// Reads are open to active users; writes are administrator-only; nothing deletes.
eq((await rows("select relrowsecurity from pg_catalog.pg_class where oid='public.accounts'::regclass"))[0].relrowsecurity, true);
eq(await privilege('authenticated', 'SELECT'), true);
eq(await privilege('authenticated', 'INSERT'), true);
eq(await privilege('authenticated', 'DELETE'), false);
eq(await privilege('anon', 'SELECT'), false);

// A three-level hierarchy of summary accounts ending in a postable leaf.
await add(assets, '100', '자산', 'asset', null, false);
await add(current, '110', '유동자산', 'asset', assets, false);
await add(cash, '111', '현금및현금성자산', 'asset', current, true);
await add(revenue, '400', '매출', 'revenue', null, false);
eq((await rows('select code,is_postable from public.accounts order by code')).map((row) => [row.code, row.is_postable]), [
    ['100', false],
    ['110', false],
    ['111', true],
    ['400', false]
]);
eq((await rows("select pg_catalog.count(*)::int n from public.audit_logs where table_name='accounts'"))[0].n, 4);

// Codes are numeric and unique per company.
await rejects(() => add('67000000-0000-0000-0000-00000000000a', '111', '중복', 'asset', current), '23505');
await rejects(() => add('67000000-0000-0000-0000-00000000000b', 'AB1', '문자 코드', 'asset', null, false), '23514');
await rejects(() => add('67000000-0000-0000-0000-00000000000c', '11', '너무 짧음', 'asset', null, false), '23514');

// The hierarchy stays inside one company and one account type, and never hangs off a leaf.
await rejects(() => db.query("insert into public.accounts(company_id,parent_id,code,name,account_type) values($1,$2,'120','다른 회사 부모','asset')", [other, current]), '22023', 'parent_company_mismatch');
await rejects(() => add('67000000-0000-0000-0000-00000000000d', '410', '유형 불일치', 'revenue', current), '22023', 'parent_type_mismatch');
await rejects(() => add('67000000-0000-0000-0000-00000000000e', '112', '전표 계정 하위', 'asset', cash), '22023', 'parent_is_postable');
// The before-trigger runs ahead of the foreign key, so a missing parent reports a business reason.
await rejects(() => add('67000000-0000-0000-0000-00000000000f', '113', '없는 부모', 'asset', '67000000-0000-0000-0000-0000000000ff'), '22023', 'parent_not_found');

// A loop is refused, including an account pointing at itself.
await rejects(() => db.query('update public.accounts set parent_id=id where id=$1', [current]), '22023', 'invalid_parent');
await rejects(() => db.query('update public.accounts set parent_id=$2 where id=$1', [assets, current]), '22023', 'invalid_parent');

// Deactivating a summary account deactivates everything beneath it.
eq(await activeCount(), 4);
await db.query('update public.accounts set is_active=false where id=$1', [assets]);
eq(await activeCount(), 1);
eq((await rows('select is_active from public.accounts where id=$1', [cash]))[0].is_active, false);
await rejects(() => db.query('update public.accounts set is_active=true where id=$1', [cash]), '22023', 'parent_inactive');
eq((await rows("select pg_catalog.count(*)::int n from public.audit_logs where table_name='accounts' and action='update'"))[0].n, 3);

// Reviving the top of the branch first lets the children follow.
await db.query('update public.accounts set is_active=true where id=$1', [assets]);
await db.query('update public.accounts set is_active=true where id=$1', [current]);
await db.query('update public.accounts set is_active=true where id=$1', [cash]);
eq(await activeCount(), 4);

// Ordinary users read but never write, and nobody deletes.
await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.accounts'))[0].n, 4);
await rejects(() => db.query("insert into public.accounts(company_id,code,name,account_type) values($1,'999','일반 사용자','expense')", [company]), '42501');
await rejects(() => db.query('delete from public.accounts where id=$1', [cash]), '42501');

console.log(`Chart of accounts migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
