import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const ok = (actual) => { assert.ok(actual); checks++; };
const fails = async (fn, code = '42501', message) => { await assert.rejects(fn, error => error.code === code && (!message || error.message === message)); checks++; };

const admin = '91000000-0000-4000-8000-000000000001';
const hr = '91000000-0000-4000-8000-000000000002';
const employeeAccount = '91000000-0000-4000-8000-000000000003';
const company = '92000000-0000-4000-8000-000000000001';
const otherCompany = '92000000-0000-4000-8000-000000000002';
const mainSite = '93000000-0000-4000-8000-000000000001';
const otherSite = '93000000-0000-4000-8000-000000000002';

await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('request.aal',true))$$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
grant usage on schema auth to authenticated;
set request.jwt.claim.sub='${admin}';set request.aal='aal2';`);

for (const file of fs.readdirSync('supabase/migrations').filter(file => /^\d.*\.sql$/.test(file) && file < '20260915000900').sort()) {
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
}
const migration = 'supabase/migrations/20260915000900_hr_secondary_assignments.sql';
if (fs.existsSync(migration)) await db.exec(fs.readFileSync(migration, 'utf8'));

await db.query('insert into auth.users(id,email,raw_app_meta_data) select unnest($1::uuid[]),unnest($2::text[]),$3::jsonb', [
    [admin, hr, employeeAccount],
    ['admin@gmail.com', 'hr@gmail.com', 'employee@gmail.com'],
    JSON.stringify({ nexerp_provisioned: true })
]);
await db.query("update profiles set role='admin' where id=$1", [admin]);
await db.query("insert into companies(id,code,name) values($1,'C1','Company'),($2,'C2','Other')", [company, otherCompany]);
await db.query("insert into sites(id,company_id,code,name,site_type) values($1,$3,'MAIN','Main','head_office'),($2,$3,'OTHER','Other','branch')", [mainSite, otherSite, company]);

const grants = ['menu', 'read', 'create', 'update'].map(action => ({ resource: 'hr.core', action, scope: 'company' }));
const member = (id, name, extra = {}) => ({ id, name, grade: '', position: '', level: null, organizationId: null, siteId: null, active: true, from: null, to: null, ...extra });
const policy = {
    levels: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: `L${index + 1}`, permissions: index === 4 ? grants : [] })),
    members: [member(hr, 'HR', { level: 5 }), member(employeeAccount, 'Employee')],
    mappings: [
        { kind: 'grade', code: 'STAFF', level: 1, from: null, to: null },
        { kind: 'position', code: 'TEAM_LEAD', level: 4, from: null, to: null }
    ],
    roles: [],
    overrides: []
};
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) result`, args)).rows[0].result;
await rpc('enterprise_save_access_policy', [company, JSON.stringify(policy), 0, 'setup']);
await rpc('enterprise_publish_access_policy', [company, 1, 0, 'setup']);

const login = async (id = hr) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated`);
const asOwner = async (query, args = []) => {
    await db.exec('reset role');
    const result = await db.query(query, args);
    await login();
    return result;
};
await login();
for (const [kind, code, name, parentCode] of [
    ['department', 'HQ', '본부', null],
    ['department', 'DEV', '개발팀', 'HQ'],
    ['department', 'DEV1', '개발1팀', 'DEV'],
    ['department', 'SALES', '영업팀', 'HQ'],
    ['grade', 'STAFF', '사원', null],
    ['position', 'MEMBER', '팀원', null],
    ['position', 'TEAM_LEAD', '팀장', null]
]) {
    await rpc('hr_save_reference', [company, JSON.stringify({ id: null, kind, code, name, parentCode, isActive: true }), 0, 'setup']);
}

const employee = await rpc('hr_create_employee', [company, JSON.stringify({
    employeeNo: 'E1', name: '직원', profileId: employeeAccount,
    hireDate: '2020-01-01', siteId: mainSite,
    department: 'HQ', grade: 'STAFF', position: 'MEMBER'
}), 'setup']);
const employmentHistory = await rpc('hr_employment_history', [company, employee]);
eq(employmentHistory.employments.length, 1);
const employment = employmentHistory.employments[0].id;
const today = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
const tomorrow = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+1)::text d")).rows[0].d;
const dayAfterTomorrow = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+2)::text d")).rows[0].d;

const history = targetEmployee => rpc('hr_secondary_assignment_history', [company, targetEmployee]);
const prepare = targetEmployee => rpc('hr_prepare_secondary_assignment', [company, targetEmployee]);
const createSecondary = (targetEmployee, revision, document, reason = '겸직 등록') => rpc('hr_create_secondary_assignment', [company, targetEmployee, revision, JSON.stringify(document), reason]);
const endSecondary = (targetEmployee, assignment, employeeRevision, assignmentRevision, endDate, reason = '겸직 종료') => rpc('hr_end_secondary_assignment', [company, targetEmployee, assignment, employeeRevision, assignmentRevision, endDate, reason]);
const cancelSecondary = (targetEmployee, assignment, employeeRevision, assignmentRevision, reason = '예정 취소') => rpc('hr_cancel_secondary_assignment', [company, targetEmployee, assignment, employeeRevision, assignmentRevision, reason]);

let result = await history(employee);
eq(result.companyId, company);
eq(result.employeeId, employee);
eq(result.assignments, []);
eq(result.permissions, { create: true, end: true, cancel: true });
const prepared = await prepare(employee);
eq(prepared.primary.grade, 'STAFF');
eq(prepared.employmentCycles[0].id, employment);

result = await createSecondary(employee, 1, {
    employmentId: employment,
    siteId: mainSite,
    department: 'DEV',
    position: 'TEAM_LEAD',
    startDate: tomorrow,
    endDate: null
});
eq(result.employeeRevision, 2);
eq(result.assignments[0].status, 'planned');
eq(result.assignments[0].grade, 'STAFF');
eq(result.assignments[0].department, 'DEV');
const planned = result.assignments[0];

await fails(() => createSecondary(employee, 2, {
    employmentId: employment,
    siteId: mainSite,
    department: 'DEV',
    position: 'MEMBER',
    startDate: tomorrow,
    endDate: dayAfterTomorrow
}), '22023', 'secondary_overlap');
await fails(() => createSecondary(employee, 2, {
    employmentId: employment,
    siteId: mainSite,
    department: 'HQ',
    position: 'TEAM_LEAD',
    startDate: tomorrow,
    endDate: null
}), '22023', 'primary_assignment_conflict');

result = await cancelSecondary(employee, planned.id, 2, 1);
eq(result.employeeRevision, 3);
eq(result.assignments[0].status, 'cancelled');
await fails(() => cancelSecondary(employee, planned.id, 3, 2), '22023', 'planned_assignment_required');

result = await createSecondary(employee, 3, {
    employmentId: employment,
    siteId: mainSite,
    department: 'SALES',
    position: 'MEMBER',
    startDate: today,
    endDate: null
});
const active = result.assignments.at(-1);
eq(active.status, 'active');
await fails(() => cancelSecondary(employee, active.id, 4, 1), '22023', 'planned_assignment_required');
result = await endSecondary(employee, active.id, 4, 1, tomorrow);
eq(result.assignments.at(-1).endDate, tomorrow);
eq(result.assignments.at(-1).revision, 2);

await db.exec('reset role');
eq((await db.query("select count(*)::int c from information_schema.role_table_grants where table_name='hr_secondary_assignments' and grantee='authenticated'")).rows[0].c, 0);
eq((await db.query("select relrowsecurity from pg_class where oid='public.hr_secondary_assignments'::regclass")).rows[0].relrowsecurity, true);
eq((await db.query('select count(*)::int c from public.hr_secondary_assignments where company_id=$1 and employee_id=$2', [company, employee])).rows[0].c, 2);
await db.exec('set role authenticated');
await fails(() => db.query('select * from public.hr_secondary_assignments'));
await db.exec('reset role');

ok(checks >= 22);
console.log(`HR secondary assignments: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
