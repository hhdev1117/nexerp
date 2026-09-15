// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const admin = '61000000-0000-0000-0000-000000000001',
    member = '61000000-0000-0000-0000-000000000002',
    company = '62000000-0000-0000-0000-000000000001',
    other = '62000000-0000-0000-0000-000000000002',
    item = '65000000-0000-0000-0000-000000000001';
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
insert into public.role_menu_permissions values ('admin','{inventory.stock,inventory.items}',1),('approver','{inventory.items,master.items}',1),('user','{inventory.stock}',1);
set request.jwt.claim.sub='${admin}'; set request.aal='aal2';`);
for (const file of ['20260914000100_add_companies_and_sites.sql', '20260914000200_add_partners.sql', '20260915001100_upgrade_partner_master.sql', '20260915001200_add_audit_logs.sql', '20260915001400_add_items.sql'])
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
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
const privilege = async (role, name) => (await rows('select pg_catalog.has_table_privilege($1,$2,$3) granted', [role, 'public.items', name]))[0].granted;

await db.query("insert into public.companies(id,code,name) values($1,'NXM','넥서스 제조'),($2,'NXD','넥서스 유통')", [company, other]);

// Reads are open to active users; writes are administrator-only; nothing deletes.
eq((await rows("select relrowsecurity from pg_catalog.pg_class where oid='public.items'::regclass"))[0].relrowsecurity, true);
eq(await privilege('authenticated', 'SELECT'), true);
eq(await privilege('authenticated', 'INSERT'), true);
eq(await privilege('authenticated', 'UPDATE'), true);
eq(await privilege('authenticated', 'DELETE'), false);
eq(await privilege('anon', 'SELECT'), false);

// The legacy inventory menu key folds into the single master ledger key.
eq(
    (await rows('select role::text,allowed_menu_keys,revision from public.role_menu_permissions order by role::text')).map((row) => [row.role, [...row.allowed_menu_keys].sort().join(','), row.revision]),
    [
        ['admin', 'inventory.stock,master.items', 2],
        ['approver', 'master.items', 2],
        ['user', 'inventory.stock', 1]
    ]
);

// Codes are unique per company and normalized shapes are enforced by the database.
await db.query("insert into public.items(id,company_id,code,name,item_type,unit,safety_stock,standard_price) values($1,$2,'RM-AL-001','알루미늄 시트 2T','raw_material','EA',120,15000)", [item, company]);
eq((await rows('select code,item_type::text,unit,safety_stock::float8,standard_price::float8,is_active from public.items'))[0], { code: 'RM-AL-001', item_type: 'raw_material', unit: 'EA', safety_stock: 120, standard_price: 15000, is_active: true });
await rejects(() => db.query("insert into public.items(company_id,code,name) values($1,'RM-AL-001','중복 코드')", [company]), '23505');
await db.query("insert into public.items(company_id,code,name) values($1,'RM-AL-001','다른 회사 동일 코드')", [other]);
eq((await rows('select pg_catalog.count(*)::int n from public.items'))[0].n, 2);
await rejects(() => db.query("insert into public.items(company_id,code,name) values($1,'rm-lower','형식 오류')", [company]), '23514');
await rejects(() => db.query("insert into public.items(company_id,code,name,unit) values($1,'RM-U1','단위 오류','ea')", [company]), '23514');
await rejects(() => db.query("insert into public.items(company_id,code,name,safety_stock) values($1,'RM-S1','음수 안전재고',-1)", [company]), '23514');
await rejects(() => db.query("insert into public.items(company_id,code,name,standard_price) values($1,'RM-P1','음수 단가',-1)", [company]), '23514');

// Audit columns record the caller and the shared change ledger captures every write.
eq((await rows('select created_by,updated_by from public.items where id=$1', [item]))[0], { created_by: admin, updated_by: admin });
eq(
    (await rows("select action::text,record_id,company_id from public.audit_logs where table_name='items' order by id")).map((row) => [row.action, row.record_id, row.company_id]),
    [
        ['insert', item, company],
        ['insert', (await rows("select id from public.items where company_id=$1", [other]))[0].id, other]
    ]
);
await db.query("update public.items set safety_stock=200 where id=$1", [item]);
const changed = (await rows("select old_data,new_data from public.audit_logs where table_name='items' and action='update' order by id")).at(-1);
eq([Number(changed.old_data.safety_stock), Number(changed.new_data.safety_stock)], [120, 200]);

// An active item cannot sit under an inactive company.
await db.query('update public.companies set is_active=false where id=$1', [other]);
await rejects(() => db.query("insert into public.items(company_id,code,name) values($1,'RM-NEW','비활성 회사 품목')", [other]), '22023', 'company_inactive');
await db.query("insert into public.items(company_id,code,name,is_active) values($1,'RM-ARC','보관용 품목',false)", [other]);

// Ordinary users read but never write, and nobody deletes.
await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);
eq((await rows('select pg_catalog.count(*)::int n from public.items'))[0].n, 3);
await rejects(() => db.query("insert into public.items(company_id,code,name) values($1,'RM-USR','일반 사용자')", [company]), '42501');
await db.query("update public.items set name='변경 시도' where id=$1", [item]);
await db.exec('reset role');
eq((await rows('select name from public.items where id=$1', [item]))[0].name, '알루미늄 시트 2T');
await db.exec(`reset role;set request.jwt.claim.sub='${admin}';set role authenticated`);
await rejects(() => db.query('delete from public.items where id=$1', [item]), '42501');

console.log(`Item master migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
