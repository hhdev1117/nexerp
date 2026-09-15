// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const admin = '61000000-0000-0000-0000-000000000001',
    member = '61000000-0000-0000-0000-000000000002',
    company = '62000000-0000-0000-0000-000000000001',
    other = '62000000-0000-0000-0000-000000000002',
    site = '63000000-0000-0000-0000-000000000001',
    otherSite = '63000000-0000-0000-0000-000000000002',
    warehouse = '66000000-0000-0000-0000-000000000001';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create type public.app_role as enum ('admin','approver','user');
create table public.profiles(id uuid primary key,role public.app_role not null default 'user',is_active boolean not null default true);
create function private.is_aal2() returns boolean language sql as $$select current_setting('request.aal',true)='aal2'$$;
create function private.is_admin() returns boolean language sql security definer as $$select coalesce(private.is_aal2() and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active),false)$$;
grant usage on schema auth,private to authenticated;
create table public.role_menu_permissions(role public.app_role primary key,allowed_menu_keys text[] not null default '{}',revision integer not null default 1);
create function public.keep_role_menu_permissions() returns trigger language plpgsql as $$begin return new; end;$$;
create trigger protect_admin_role_menu_permissions before update on public.role_menu_permissions for each row execute function public.keep_role_menu_permissions();
insert into public.profiles values ('${admin}','admin',true),('${member}','user',true);
set request.jwt.claim.sub='${admin}'; set request.aal='aal2';`);
for (const file of ['20260914000100_add_companies_and_sites.sql', '20260914000200_add_partners.sql', '20260915001200_add_audit_logs.sql', '20260916001500_add_warehouses.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
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
const privilege = async (role, name) => (await rows('select pg_catalog.has_table_privilege($1,$2,$3) granted', [role, 'public.warehouses', name]))[0].granted;
const activeWarehouses = async () => (await rows('select pg_catalog.count(*)::int n from public.warehouses where is_active'))[0].n;

await db.query("insert into public.companies(id,code,name) values($1,'NXM','넥서스 제조'),($2,'NXD','넥서스 유통')", [company, other]);
await db.query("insert into public.sites(id,company_id,code,name,site_type) values($1,$2,'ICN','인천 공장','factory'),($3,$4,'BSN','부산 물류센터','warehouse')", [site, company, otherSite, other]);

// Reads are open to active users; writes are administrator-only; nothing deletes.
eq((await rows("select relrowsecurity from pg_catalog.pg_class where oid='public.warehouses'::regclass"))[0].relrowsecurity, true);
eq(await privilege('authenticated', 'SELECT'), true);
eq(await privilege('authenticated', 'INSERT'), true);
eq(await privilege('authenticated', 'UPDATE'), true);
eq(await privilege('authenticated', 'DELETE'), false);
eq(await privilege('anon', 'SELECT'), false);

// A warehouse records its site, its company and the caller, and lands in the change ledger.
await db.query("insert into public.warehouses(id,company_id,site_id,code,name,warehouse_type) values($1,$2,$3,'WH-RM','인천 원자재창고','raw_material')", [warehouse, company, site]);
eq((await rows('select code,warehouse_type::text,is_active,created_by from public.warehouses'))[0], { code: 'WH-RM', warehouse_type: 'raw_material', is_active: true, created_by: admin });
eq(
    (await rows("select action::text,record_id,company_id from public.audit_logs where table_name='warehouses' order by id")).map((row) => [row.action, row.record_id, row.company_id]),
    [['insert', warehouse, company]]
);

// Codes are unique per company, and the site must belong to the same company.
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-RM','중복 코드')", [company, site]), '23505');
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-X','회사 불일치')", [company, otherSite]), '22023', 'site_company_mismatch');
// The before-trigger runs ahead of the foreign key, so a missing site reports a business reason.
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-X','없는 사업장')", [company, '63000000-0000-0000-0000-0000000000ff']), '22023', 'site_not_found');
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'wh-lower','형식 오류')", [company, site]), '23514');
await db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-RM','다른 회사 동일 코드')", [other, otherSite]);
eq((await rows('select pg_catalog.count(*)::int n from public.warehouses'))[0].n, 2);

// Ordinary users read but never write, and nobody deletes. Checked while the sites are still
// active, because the before-trigger would otherwise refuse the row before row-level security does.
await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.warehouses'))[0].n, 2);
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-USR','일반 사용자')", [company, site]), '42501');
await rejects(() => db.query('delete from public.warehouses where id=$1', [warehouse]), '42501');
await db.exec(`reset role;set request.jwt.claim.sub='${admin}';set role authenticated`);

// Deactivating a site deactivates the warehouses inside it, and they cannot be revived alone.
eq(await activeWarehouses(), 2);
await db.query('update public.sites set is_active=false where id=$1', [site]);
eq(await activeWarehouses(), 1);
await rejects(() => db.query('update public.warehouses set is_active=true where id=$1', [warehouse]), '22023', 'site_inactive');
await rejects(() => db.query("insert into public.warehouses(company_id,site_id,code,name) values($1,$2,'WH-NEW','비활성 사업장 창고')", [company, site]), '22023', 'site_inactive');
await db.query("insert into public.warehouses(company_id,site_id,code,name,is_active) values($1,$2,'WH-ARC','보관용 창고',false)", [company, site]);

// Deactivating a company reaches warehouses through the site cascade.
await db.query('update public.companies set is_active=false where id=$1', [other]);
eq(await activeWarehouses(), 0);
eq((await rows("select pg_catalog.count(*)::int n from public.audit_logs where table_name='warehouses' and action='update'"))[0].n, 2);

// Every warehouse stays readable after deactivation so history keeps its references.
await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.warehouses'))[0].n, 3);

console.log(`Warehouse master migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
