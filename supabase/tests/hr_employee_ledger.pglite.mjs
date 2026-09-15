// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create table public.profiles(id uuid primary key,role text,is_active boolean);
create function private.is_aal2() returns boolean language sql as $$select current_setting('request.aal',true)='aal2'$$;
create function private.is_admin() returns boolean language sql security definer as $$select coalesce(private.is_aal2() and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active),false)$$;
grant usage on schema auth,private to authenticated;
insert into profiles values ('61000000-0000-0000-0000-000000000001','admin',true),('61000000-0000-0000-0000-000000000002','user',true),('61000000-0000-0000-0000-000000000003','user',true);
set request.jwt.claim.sub='61000000-0000-0000-0000-000000000001'; set request.aal='aal2';`);
for (const f of ['20260914000100_add_companies_and_sites.sql', '20260914000200_enterprise_access_policy.sql', '20260914000300_enterprise_access_activation.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + f, 'utf8'));
const company = '62000000-0000-0000-0000-000000000001',
    other = '62000000-0000-0000-0000-000000000002',
    actor = '61000000-0000-0000-0000-000000000002',
    site = '63000000-0000-0000-0000-000000000001';
await db.query("insert into companies(id,code,name) values($1,'C1','Company'),($2,'C2','Other')", [company, other]);
await db.query("insert into sites(id,company_id,code,name) values($1,$2,'S1','Site')", [site, company]);
const policy = {
    levels: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Level ${i + 1}`, permissions: i === 0 ? ['menu', 'read', 'update', 'create'].map((action) => ({ resource: 'settings.company', action, scope: 'company' })) : [] })),
    members: [{ id: actor, name: 'User', grade: 'G', position: 'P', level: 1, organizationId: null, siteId: site, active: true, from: null, to: null }],
    mappings: [],
    roles: [],
    overrides: []
};
if (fs.existsSync('supabase/migrations/20260914000400_hr_employee_ledger.sql')) await db.exec(fs.readFileSync('supabase/migrations/20260914000400_hr_employee_ledger.sql', 'utf8'));
let checks = 0;
const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
};
const rejects = async (fn, code) => {
    await assert.rejects(fn, (e) => e.code === code);
    checks++;
};
const rpc = async (name, args = [], params = '') => (await db.query(`select public.${name}(${params}) result`, args)).rows[0].result;
const context = (id = company) => rpc('enterprise_access_context', [id], '$1');
const save = (p, r) => db.query("select * from enterprise_save_access_policy($1,$2,$3,'test')", [company, JSON.stringify(p), r]);
const publish = (d, r) => rpc('enterprise_publish_access_policy', [company, d, r], "$1,$2,$3,'publish'");
const login = async (id) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated`);
const admin = () => login('61000000-0000-0000-0000-000000000001');

const directory = () => rpc('hr_directory', [company], '$1');
await admin();
await rejects(() => directory(), '42501');
const hr = structuredClone(policy);
hr.members.push({ ...hr.members[0], id: '61000000-0000-0000-0000-000000000003', name: 'Future', from: '2099-01-01' });
hr.levels[0].permissions.push(...['menu', 'read', 'create', 'update'].map((action) => ({ resource: 'hr.core', action, scope: 'company' })));
await save(hr, 0);
await publish(1, 0);
await rejects(() => directory(), '42501');
await login(actor);
eq((await directory()).employees, []);
eq((await directory()).accounts, [
    { id: '61000000-0000-0000-0000-000000000003', name: 'Future' },
    { id: actor, name: 'User' }
]);
const today = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
const tomorrow = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+1)::text d")).rows[0].d;
const later = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+2)::text d")).rows[0].d;
const employee = { employeeNo: 'E001', name: 'Employee', profileId: actor, hireDate: '2020-01-01', siteId: site, department: 'D1', grade: 'G', position: 'P' };
const create = (doc = employee) => rpc('hr_create_employee', [company, JSON.stringify(doc), 'Registration'], '$1,$2,$3');
await rejects(() => create({ ...employee, extra: true }), '22023');
await rejects(() => create({ ...employee, profileId: '61000000-0000-0000-0000-000000000001' }), '22023');
await db.exec("reset role;update profiles set is_active=false where id='61000000-0000-0000-0000-000000000003'");
await login(actor);
eq((await directory()).accounts, [{ id: actor, name: 'User' }]);
await rejects(() => create({ ...employee, profileId: '61000000-0000-0000-0000-000000000003' }), '22023');
await db.exec("reset role;update profiles set is_active=true where id='61000000-0000-0000-0000-000000000003'");
await login(actor);
await create({ ...employee, employeeNo: 'E003', profileId: null });
const id = await create();
eq((await directory()).accounts, [{ id: '61000000-0000-0000-0000-000000000003', name: 'Future' }]);
eq((await directory()).employees[0].status, 'active');
await rejects(() => create(), '22023');
const action = (type, date = tomorrow) => ({ type, effectiveDate: date, siteId: site, department: 'D2', grade: 'G2', position: 'P2', reason: 'Personnel decision' });
const record = (doc, rev = 1) => rpc('hr_record_personnel_action', [company, id, rev, JSON.stringify(doc)], '$1,$2,$3,$4');
await rejects(() => record(action('transfer', '2020-01-02')), '22023');
await rejects(() => record(action('transfer'), 0), '40001');
const transfer = await record(action('transfer'));
eq((await directory()).employees[0].department, 'D1');
await rejects(() => record(action('transfer'), 2), '22023');
const terminate = await record(action('terminate', later), 2);
await rejects(() => rpc('hr_cancel_personnel_action', [company, id, transfer, 3, 'Cancel'], '$1,$2,$3,$4,$5'), '22023');
await rpc('hr_cancel_personnel_action', [company, id, terminate, 3, 'Cancel'], '$1,$2,$3,$4,$5');
await rpc('hr_cancel_personnel_action', [company, id, transfer, 4, 'Cancel'], '$1,$2,$3,$4,$5');
eq((await directory()).employees[0].revision, 5);
await rejects(() => db.query('select * from hr_employees'), '42501');
await rejects(() => rpc('hr_directory', [other], '$1'), '42501');
// Cross-company references, primitive validation and scope grants fail closed.
await db.exec('reset role');
const foreignSite = '63000000-0000-0000-0000-000000000002';
await db.query("insert into sites(id,company_id,code,name) values($1,$2,'S2','Other site')", [foreignSite, other]);
await login(actor);
await rejects(() => create({ ...employee, employeeNo: 'E2', profileId: null, siteId: foreignSite }), '22023');
await rejects(() => create({ ...employee, employeeNo: 'E2', profileId: null, grade: null }), '22023');
await rejects(() => record({ ...action('transfer'), reason: 42 }, 5), '22023');
await rejects(() => rpc('hr_directory', [company, '', 0], '$1,$2,$3'), '22023');
await admin();
const scoped = structuredClone(hr);
scoped.levels[0].permissions.filter((p) => p.resource === 'hr.core').forEach((p) => (p.scope = 'site'));
await save(scoped, 1);
await publish(2, 1);
await login(actor);
await rejects(() => directory(), '42501');
eq((await context()).menuKeys.includes('hr.core'), false);
await admin();
await save(hr, 2);
await publish(3, 2);
await login(actor);
// Read-only HR operators receive no account choice catalog.
await db.exec('reset role');
const snapshot = (await db.query('select policy from enterprise_access_publications where company_id=$1 order by revision desc limit 1', [company])).rows[0].policy;
const noCreate = structuredClone(snapshot);
noCreate.levels[0].permissions = noCreate.levels[0].permissions.filter((p) => !(p.resource === 'hr.core' && p.action === 'create'));
await db.query('update enterprise_access_publications set policy=$2 where company_id=$1 and revision=3', [company, JSON.stringify(noCreate)]);
await login(actor);
eq((await directory()).accounts, []);
eq((await directory()).permissions.create, false);
await db.exec('reset role');
await db.query('update enterprise_access_publications set policy=$2 where company_id=$1 and revision=3', [company, JSON.stringify(snapshot)]);
await login(actor);
// Immediate transfer drives membership attributes; explicit level survives.
await create({ ...employee, employeeNo: 'E2', profileId: '61000000-0000-0000-0000-000000000003' });
eq((await directory()).accounts, []);
await record(action('transfer', today), 5);
await db.exec('reset role');
const derived = (await db.query('select private.enterprise_member($1,(select policy from enterprise_access_publications where company_id=$1 order by revision desc limit 1)) m', [company])).rows[0].m;
eq(derived.organizationId, 'D2');
eq(derived.grade, 'G2');
eq(derived.level, 1);
// A narrower deny cannot leak a company-wide directory.
await admin();
const narrow = structuredClone(hr);
narrow.overrides = [{ actorId: actor, resource: 'hr.core', action: 'read', scope: 'site', effect: 'deny', from: null, to: null }];
await save(narrow, 3);
await publish(4, 3);
await login(actor);
await rejects(() => directory(), '42501');
eq((await context()).menuKeys.includes('hr.core'), false);
await admin();
await rpc('enterprise_revert_access_policy', [company, 4], "$1,$2,'restore'");
await login(actor);
// Simulate the next Seoul day by moving this fixture's effective date to yesterday.
await db.exec('reset role');
await db.query('update hr_personnel_actions set effective_date=effective_date-1 where employee_id=$1 and cancelled_at is null', [id]);
await login(actor);
// Membership required: a linked profile is not automatically authorized.
await login('61000000-0000-0000-0000-000000000003');
await rejects(() => directory(), '42501');
await login(actor);
await db.exec('reset role');
await db.query('update sites set is_active=false where id=$1', [site]);
await login(actor);
await record(action('terminate', today), 6);
eq((await context()).companyId, null);
await rejects(() => directory(), '42501');
await db.exec('reset role');
eq((await db.query('select private.hr_employee_state($1,$2) s', [company, id])).rows[0].s.department, 'D2');
await login(actor);
// Publication reversal must not restore a terminated employee.
await admin();
await save(hr, 4);
await publish(5, 5);
await rpc('enterprise_revert_access_policy', [company, 6], "$1,$2,'restore'".replaceAll('\\', ''));
await login(actor);
eq((await context()).companyId, null);
// Independent company proves effective ledger codes change real menu grants.
await db.exec('reset role');
await db.query('update sites set is_active=true where id=$1', [foreignSite]);
const mapped = structuredClone(policy);
mapped.members[0] = { ...mapped.members[0], level: null, siteId: foreignSite };
mapped.mappings = [
    { kind: 'grade', code: 'G', level: 1, from: null, to: null },
    { kind: 'position', code: 'P2', level: 4, from: null, to: null }
];
mapped.levels[0].permissions.push(...['menu', 'read', 'create', 'update'].map((action) => ({ resource: 'hr.core', action, scope: 'company' })));
mapped.levels[3].permissions = ['menu', 'read'].map((action) => ({ resource: 'sales.orders', action, scope: 'company' }));
const saveOther = (doc, revision) => db.query("select * from enterprise_save_access_policy($1,$2,$3,'mapping test')", [other, JSON.stringify(doc), revision]);
const publishOther = (draft, revision) => rpc('enterprise_publish_access_policy', [other, draft, revision], "$1,$2,$3,'mapping test'");
await admin();
await saveOther(mapped, 0);
await publishOther(1, 0);
await login(actor);
const mappedId = await rpc('hr_create_employee', [other, JSON.stringify({ ...employee, siteId: foreignSite }), 'Mapping registration'], '$1,$2,$3');
eq((await context(other)).menuKeys.includes('sales.orders'), false);
await rpc('hr_record_personnel_action', [other, mappedId, 1, JSON.stringify({ ...action('transfer', tomorrow), siteId: foreignSite })], '$1,$2,$3,$4');
eq((await context(other)).menuKeys.includes('sales.orders'), false);
// Advancing the dated fixture models its arrival without changing authorization code.
await db.exec('reset role');
await db.query('update hr_personnel_actions set effective_date=$2::date where employee_id=$1', [mappedId, today]);
await login(actor);
eq((await context(other)).menuKeys, ['sales.orders']);
await admin();
mapped.members[0].level = 1;
await saveOther(mapped, 1);
await publishOther(2, 1);
await login(actor);
eq((await context(other)).menuKeys.includes('sales.orders'), false);
eq((await context(other)).menuKeys.includes('hr.core'), true);
console.log(`HR migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
