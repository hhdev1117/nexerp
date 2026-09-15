// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const admin = '61000000-0000-0000-0000-000000000001',
    member = '61000000-0000-0000-0000-000000000002',
    company = '62000000-0000-0000-0000-000000000001',
    site = '63000000-0000-0000-0000-000000000001',
    partner = '64000000-0000-0000-0000-000000000001';
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
for (const file of ['20260914000100_add_companies_and_sites.sql', '20260914000200_add_partners.sql', '20260915001100_upgrade_partner_master.sql', '20260915001200_add_audit_logs.sql'])
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
let checks = 0;
const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
};
const rejects = async (run, code) => {
    await assert.rejects(run, (error) => error.code === code);
    checks++;
};
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const ledger = () => rows('select table_name,record_id,company_id,action,actor_id,old_data,new_data from public.audit_logs order by id');
const count = async () => (await rows('select pg_catalog.count(*)::int n from public.audit_logs'))[0].n;
const privilege = async (role, name) => (await rows('select pg_catalog.has_table_privilege($1,$2,$3) granted', [role, 'public.audit_logs', name]))[0].granted;
const session = (id, aal = 'aal2') => db.exec(`reset role;set request.jwt.claim.sub='${id}';set request.aal='${aal}';set role authenticated`);
const owner = () => db.exec(`reset role;set request.jwt.claim.sub='${admin}';set request.aal='aal2'`);

// The ledger is readable but never writable through a client connection.
eq((await rows("select relrowsecurity from pg_catalog.pg_class where oid='public.audit_logs'::regclass"))[0].relrowsecurity, true);
eq(await privilege('authenticated', 'SELECT'), true);
eq(await privilege('authenticated', 'INSERT'), false);
eq(await privilege('authenticated', 'UPDATE'), false);
eq(await privilege('authenticated', 'DELETE'), false);
eq(await privilege('anon', 'SELECT'), false);

// Inserts record the caller, the new values and the company the row belongs to.
await db.query("insert into public.companies(id,code,name) values($1,'NXM','넥서스 제조')", [company]);
const created = await ledger();
eq(created.length, 1);
eq(created[0].table_name, 'companies');
eq(created[0].action, 'insert');
eq(created[0].record_id, company);
eq(created[0].company_id, company);
eq(created[0].actor_id, admin);
eq(created[0].old_data, null);
eq(created[0].new_data.code, 'NXM');

// Updates keep both sides so a screen can show what actually changed.
await db.query("update public.companies set name='넥서스 제조 주식회사' where id=$1", [company]);
const changed = (await ledger()).at(-1);
eq(changed.action, 'update');
eq(changed.old_data.name, '넥서스 제조');
eq(changed.new_data.name, '넥서스 제조 주식회사');

// A re-save that changes no business value adds no noise, even though updated_at moved.
await db.query('update public.companies set name=name where id=$1', [company]);
eq(await count(), 2);

// Sites and partners inherit the company scope from their own column.
await db.query("insert into public.sites(id,company_id,code,name) values($1,$2,'HQ','서울 본사')", [site, company]);
const recordedSite = (await ledger()).at(-1);
eq(recordedSite.table_name, 'sites');
eq(recordedSite.record_id, site);
eq(recordedSite.company_id, company);
await db.query("insert into public.partners(id,company_id,code,name,is_customer) values($1,$2,'P1','파트너',true)", [partner, company]);
const recordedPartner = (await ledger()).at(-1);
eq(recordedPartner.table_name, 'partners');
eq(recordedPartner.company_id, company);
eq(recordedPartner.new_data.is_customer, true);

// Deactivating a company cascades to its sites, and the cascade is recorded too.
await db.query('update public.companies set is_active=false where id=$1', [company]);
const cascaded = (await ledger()).filter((row) => row.table_name === 'sites' && row.action === 'update');
eq(cascaded.length, 1);
eq(cascaded[0].old_data.is_active, true);
eq(cascaded[0].new_data.is_active, false);

// Only MFA-verified administrators read the ledger.
const total = await count();
eq(total > 0, true);
await session(member);
eq(await count(), 0);
await session(admin, 'aal1');
eq(await count(), 0);
await session(admin);
eq(await count(), total);

// Even an administrator cannot append to, amend or erase history from a client.
await rejects(() => db.query("insert into public.audit_logs(table_name,record_id,action,new_data) values('companies','x','insert','{}'::jsonb)"), '42501');
await rejects(() => db.query("update public.audit_logs set action='delete'"), '42501');
await rejects(() => db.query('delete from public.audit_logs'), '42501');

// Deletes keep the final snapshot, and the payload must match the action.
await owner();
await db.query('delete from public.partners where id=$1', [partner]);
const removed = (await ledger()).at(-1);
eq(removed.action, 'delete');
eq(removed.table_name, 'partners');
eq(removed.new_data, null);
eq(removed.old_data.code, 'P1');
await rejects(() => db.query("insert into public.audit_logs(table_name,record_id,action,old_data) values('companies','x','insert','{}'::jsonb)"), '23514');
await rejects(() => db.query("insert into public.audit_logs(table_name,record_id,action,new_data) values('companies','  ','insert','{}'::jsonb)"), '23514');

console.log(`Audit log migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
