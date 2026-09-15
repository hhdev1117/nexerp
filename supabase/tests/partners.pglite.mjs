import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1; };
const fails = async (fn, code) => { await assert.rejects(fn, (error) => error.code === code); checks += 1; };
const admin = '81000000-0000-4000-8000-000000000001';
const user = '81000000-0000-4000-8000-000000000002';
const company = '82000000-0000-4000-8000-000000000001';
const inactiveCompany = '82000000-0000-4000-8000-000000000002';
const partnerMigration = '20260915001000_add_partners.sql';

await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('request.aal',true))$$;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);grant usage on schema auth to authenticated;set request.jwt.claim.sub='${admin}';set request.aal='aal2';`);
const migrations = fs.readdirSync('supabase/migrations').filter((file) => /^\d.*\.sql$/.test(file)).sort();
for (const file of migrations.filter((file) => file !== partnerMigration)) {
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
}
await db.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb),($4,$5,$3::jsonb)', [admin, 'admin@gmail.com', JSON.stringify({ nexerp_provisioned: true }), user, 'user@gmail.com']);
await db.query("update profiles set role='admin' where id=$1", [admin]);
await db.query("insert into companies(id,code,name) values($1,'C1','Company'),($2,'C2','Inactive')", [company, inactiveCompany]);
await db.query('update companies set is_active=false where id=$1', [inactiveCompany]);
await db.query("update role_menu_permissions set allowed_menu_keys=array_append(allowed_menu_keys,'sales.customers') where role='user'");
const legacyPolicy = {
    levels: [{ id: 1, name: 'L1', permissions: [{ resource: 'sales.customers', action: 'read', scope: 'company' }] }],
    mappings: [],
    members: [],
    roles: [{ id: 'buyer', name: 'Buyer', permissions: [{ resource: 'purchasing.vendors', action: 'read', scope: 'company' }], members: [] }],
    overrides: [{ actorId: user, resource: 'sales.customers', action: 'read', scope: 'company', effect: 'allow', from: null, to: null }],
};
await db.query('insert into enterprise_access_policies(company_id,policy,revision,updated_by) values($1,$2,1,$3)', [company, legacyPolicy, admin]);
await db.query("insert into enterprise_access_policy_audit(company_id,revision,policy,reason,actor_id) values($1,1,$2,'seed',$3)", [company, legacyPolicy, admin]);
await db.query("insert into enterprise_access_publications(company_id,revision,draft_revision,policy,operation,reason,actor_id) values($1,1,1,$2,'publish','seed',$3)", [company, legacyPolicy, admin]);
await db.exec(fs.readFileSync(`supabase/migrations/${partnerMigration}`, 'utf8'));

eq((await db.query("select allowed_menu_keys @> array['master.partners'] has_new, allowed_menu_keys && array['sales.customers','purchasing.vendors'] has_legacy from role_menu_permissions where role='user'")).rows[0], { has_new: true, has_legacy: false });
eq((await db.query("select private.enterprise_resources() @> array['master.partners'] has_new, private.enterprise_resources() && array['sales.customers','purchasing.vendors'] has_legacy")).rows[0], { has_new: true, has_legacy: false });
for (const table of ['enterprise_access_policies', 'enterprise_access_policy_audit', 'enterprise_access_publications']) {
    const result = await db.query(`select policy::text like '%master.partners%' has_new, policy::text ~ 'sales.customers|purchasing.vendors' has_legacy from ${table}`);
    eq(result.rows[0], { has_new: true, has_legacy: false });
}

await db.exec('set role authenticated');
await db.query("insert into partners(company_id,code,name,is_customer,business_number) values($1,'P1','Customer',true,'1208812345')", [company]);
eq((await db.query('select code,created_by::text,is_customer,is_vendor from partners where company_id=$1', [company])).rows[0], { code: 'P1', created_by: admin, is_customer: true, is_vendor: false });
await db.query("update partners set name='Updated',updated_by=$1 where code='P1'", [user]);
eq((await db.query("select name,updated_by::text from partners where code='P1'")).rows[0], { name: 'Updated', updated_by: admin });
await fails(() => db.query("insert into partners(company_id,code,name,is_vendor,business_number) values($1,'P2','Duplicate',true,'1208812345')", [company]), '23505');
await fails(() => db.query("insert into partners(company_id,code,name) values($1,'P3','No role')", [company]), '23514');
await fails(() => db.query("insert into partners(company_id,code,name,is_customer) values($1,'P4','Inactive company',true)", [inactiveCompany]), '22023');
await db.exec(`reset role;set request.jwt.claim.sub='${user}';set role authenticated`);
eq((await db.query('select count(*)::int count from partners')).rows[0].count, 1);
await fails(() => db.query("insert into partners(company_id,code,name,is_customer) values($1,'P5','Denied',true)", [company]), '42501');
await db.exec('reset role');
eq((await db.query("select relrowsecurity from pg_class where oid='public.partners'::regclass")).rows[0].relrowsecurity, true);
eq((await db.query("select has_table_privilege('authenticated','public.partners','DELETE') allowed")).rows[0].allowed, false);
console.log(`Partners: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
