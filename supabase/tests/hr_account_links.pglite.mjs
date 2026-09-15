import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const fails = async (fn, code = '42501', message) => { await assert.rejects(fn, e => e.code === code && (!message || e.message === message)); checks++; };
const admin = '71000000-0000-0000-0000-000000000001', hr = '71000000-0000-0000-0000-000000000002';
const staff = '71000000-0000-0000-0000-000000000003', lead = '71000000-0000-0000-0000-000000000004';
const spare = '71000000-0000-0000-0000-000000000005', dormant = '71000000-0000-0000-0000-000000000006';
const company = '72000000-0000-0000-0000-000000000001';
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('request.aal',true))$$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
grant usage on schema auth to authenticated;
set request.jwt.claim.sub='${admin}'; set request.aal='aal2';`);
// Every prior migration runs unchanged so linking is proven against real data.
for (const file of fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f < '20260914000700').sort()) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
const provisioned = JSON.stringify({ nexerp_provisioned: true });
await db.query('insert into auth.users(id,email,raw_app_meta_data) select unnest($1::uuid[]),unnest($2::text[]),$3::jsonb', [[admin, hr, staff, lead, spare, dormant], ['admin@gmail.com', 'hr@gmail.com', 'staff@gmail.com', 'lead@gmail.com', 'spare@gmail.com', 'dormant@gmail.com'], provisioned]);
await db.query("update profiles set role='admin' where id=$1", [admin]);
await db.query("update profiles set display_name='사원계정' where id=$1", [staff]);
await db.query("insert into companies(id,code,name) values($1,'C1','Company')", [company]);
const member = (id, name, extra = {}) => ({ id, name, grade: '', position: '', level: null, organizationId: null, siteId: null, active: true, from: null, to: null, ...extra });
const permissions = ['menu', 'read', 'create', 'update'].map(action => ({ resource: 'hr.core', action, scope: 'company' })).concat([{ resource: 'dashboard', action: 'menu', scope: 'company' }, { resource: 'dashboard', action: 'read', scope: 'company' }]);
const policy = {
    levels: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `L${i + 1}`, permissions: i === 4 ? permissions : [] })),
    members: [member(hr, 'HR담당', { level: 5 }), member(staff, '사원계정'), member(lead, '팀장계정'), member(spare, '예비계정'), member(dormant, '휴면계정')],
    mappings: [{ kind: 'grade', code: 'STAFF', level: 1, from: null, to: null }, { kind: 'position', code: 'TEAM_LEAD', level: 4, from: null, to: null }],
    roles: [], overrides: []
};
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
await rpc('enterprise_save_access_policy', [company, JSON.stringify(policy), 0, 'setup']);
await rpc('enterprise_publish_access_policy', [company, 1, 0, 'setup']);
// The account was published as a member and later deactivated.
await db.query("update profiles set is_active=false where id=$1", [dormant]);
const login = async (id = hr) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated`);
await login();
const document = (no, name, profileId, grade, position) => JSON.stringify({ employeeNo: no, name, profileId, hireDate: '2020-01-01', siteId: null, department: 'D1', grade, position });
for (const [kind, code, name] of [['department', 'D1', '경영지원팀'], ['grade', 'STAFF', '사원'], ['grade', 'SENIOR', '대리'], ['position', 'MEMBER', '팀원'], ['position', 'TEAM_LEAD', '팀장']])
    await rpc('hr_save_reference', [company, JSON.stringify({ id: null, kind, code, name, parentCode: null, isActive: true }), 0, 'reference setup']);
const first = await rpc('hr_create_employee', [company, document('E1', '김사원', null, 'STAFF', 'MEMBER'), 'existing employee']);
const second = await rpc('hr_create_employee', [company, document('E2', '박팀장', lead, 'SENIOR', 'TEAM_LEAD'), 'existing employee']);
await db.exec('reset role');
await db.exec(fs.readFileSync('supabase/migrations/20260914000700_hr_account_links.sql', 'utf8'));
await login();

const options = (employee = first) => rpc('hr_account_link_options', [company, employee]);
const link = (employee, revision, profile, reason = '계정 연결 변경') => rpc('hr_link_employee_account', [company, employee, revision, profile, reason]);
const history = (employee = first) => rpc('hr_account_link_history', [company, employee]);

let view = await options();
eq(view.account, null);
eq(view.status, 'active');
eq(view.permissions, { link: true, unlink: false });
// The employee's own grade and position drive the preview, and accounts already
// tied to another employee never appear as candidates.
eq(view.candidates, [
    { id: hr, name: 'HR담당', preview: { level: 5, source: 'direct' } },
    { id: staff, name: '사원계정', preview: { level: 1, source: 'grade' } },
    { id: spare, name: '예비계정', preview: { level: 1, source: 'grade' } }
]);
eq((await options(second)).account, { id: lead, name: '팀장계정', listed: true, preview: { level: 4, source: 'position' } });
eq((await options(second)).candidates.map(c => c.name), ['HR담당', '사원계정', '예비계정', '팀장계정']);

await fails(() => link(first, 99, staff), '40001');
await fails(() => link(first, view.revision, null), '22023', 'account_link_unchanged');
await fails(() => link(first, view.revision, lead), '22023', 'account_unavailable');
await fails(() => link(first, view.revision, dormant), '22023', 'account_unavailable');
await fails(() => link(first, view.revision, admin), '22023', 'account_unavailable');
await fails(() => link(first, view.revision, staff, '  '), '22023', 'invalid_account_link');

view = await link(first, view.revision, staff);
eq(view.account, { id: staff, name: '사원계정', listed: true, preview: { level: 1, source: 'grade' } });
eq(view.permissions, { link: true, unlink: true });
eq(view.revision, 2);
eq((await history()).map(row => [row.beforeAccountId, row.afterAccountId, row.reason]), [[null, staff, '계정 연결 변경']]);
eq((await options(second)).candidates.map(c => c.id), [hr, spare, lead]);

// A linked employee grants the mapped level to that account, and unlinking
// removes the employment-derived level in the same request path.
await login(staff);
eq((await rpc('enterprise_access_context', [company])).menuKeys.includes('hr.core'), false);
await login();
view = await link(first, view.revision, spare, '담당자 교체');
eq(view.account.id, spare);
eq((await history()).map(row => [row.beforeAccountId, row.afterAccountId]), [[staff, spare], [null, staff]]);
await login(staff);
await fails(() => options());
await login();

view = await link(first, view.revision, null, '퇴사 예정 계정 회수');
eq(view.account, null);
eq(view.permissions, { link: true, unlink: false });
eq(view.revision, 4);

// Terminated employees keep their history and account, but never gain a new one.
const today = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
view = await link(second, 1, spare, '팀장 계정 교체');
eq(view.account.id, spare);
await rpc('hr_record_personnel_action', [company, second, view.revision, JSON.stringify({ type: 'terminate', effectiveDate: today, siteId: null, department: 'D1', grade: 'SENIOR', position: 'TEAM_LEAD', reason: '퇴사' })]);
view = await options(second);
eq(view.status, 'terminated');
eq(view.permissions, { link: false, unlink: true });
await fails(() => link(second, view.revision, lead), '22023', 'employee_terminated');
view = await link(second, view.revision, null, '퇴사 계정 회수');
eq(view.account, null);

// Module state gates linking exactly like other HR writes.
await login(admin);
await rpc('hr_save_module_settings', [company, 'hr.core', 0, 'read_only', true, '조회 전용 전환']);
await login();
eq((await options()).permissions, { link: false, unlink: false });
await fails(() => link(first, 4, staff));
await login(admin);
await rpc('hr_save_module_settings', [company, 'hr.core', 1, 'disabled', true, '사용 중지']);
await login();
await fails(() => options());
await fails(() => history());
await login(admin);
await rpc('hr_save_module_settings', [company, 'hr.core', 2, 'enabled', true, '재개']);

// Accounts without published HR permission cannot read or change links.
await login(spare);
await fails(() => options());
await fails(() => link(first, 4, staff));
await login(admin);
await fails(() => options());
await db.exec('reset role');
eq((await db.query('select count(*)::int c from public.hr_employee_account_links')).rows[0].c, 5);
await db.exec('set role authenticated');
await fails(() => db.query('select * from public.hr_employee_account_links'), '42501');
await db.exec('reset role');
console.log(`HR account links: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
