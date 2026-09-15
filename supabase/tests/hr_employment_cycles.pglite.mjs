import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const eq = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
};
const ok = (actual) => {
    assert.ok(actual);
    checks++;
};
const fails = async (fn, code = '42501', message) => {
    await assert.rejects(fn, (e) => e.code === code && (!message || e.message === message));
    checks++;
};
const admin = '81000000-0000-0000-0000-000000000001',
    hr = '81000000-0000-0000-0000-000000000002';
const oldAccount = '81000000-0000-0000-0000-000000000003',
    newAccount = '81000000-0000-0000-0000-000000000004';
const spare = '81000000-0000-0000-0000-000000000005',
    company = '82000000-0000-0000-0000-000000000001';
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('request.aal',true))$$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
grant usage on schema auth to authenticated;
set request.jwt.claim.sub='${admin}';set request.aal='aal2';`);
for (const file of fs
    .readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql') && f < '20260915000800')
    .sort())
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
await db.query('insert into auth.users(id,email,raw_app_meta_data) select unnest($1::uuid[]),unnest($2::text[]),$3::jsonb', [
    [admin, hr, oldAccount, newAccount, spare],
    ['admin@gmail.com', 'hr@gmail.com', 'old@gmail.com', 'new@gmail.com', 'spare@gmail.com'],
    JSON.stringify({ nexerp_provisioned: true })
]);
await db.query("update profiles set role='admin' where id=$1", [admin]);
await db.query("update profiles set display_name=case id when $1 then '기존계정' when $2 then '신규계정' else display_name end", [oldAccount, newAccount]);
await db.query("insert into companies(id,code,name) values($1,'C1','Company')", [company]);
const member = (id, name, extra = {}) => ({ id, name, grade: '', position: '', level: null, organizationId: null, siteId: null, active: true, from: null, to: null, ...extra });
const grants = ['menu', 'read', 'create', 'update'].map((action) => ({ resource: 'hr.core', action, scope: 'company' }));
const policy = {
    levels: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `L${i + 1}`, permissions: i === 4 ? grants : [] })),
    members: [member(hr, 'HR', { level: 5 }), member(oldAccount, '기존계정'), member(newAccount, '신규계정'), member(spare, '예비계정')],
    mappings: [
        { kind: 'grade', code: 'STAFF', level: 1, from: null, to: null },
        { kind: 'position', code: 'TEAM_LEAD', level: 4, from: null, to: null }
    ],
    roles: [],
    overrides: []
};
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
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
for (const [kind, code, name] of [
    ['department', 'D1', '지원팀'],
    ['grade', 'STAFF', '사원'],
    ['grade', 'SENIOR', '대리'],
    ['position', 'MEMBER', '팀원'],
    ['position', 'TEAM_LEAD', '팀장']
])
    await rpc('hr_save_reference', [company, JSON.stringify({ id: null, kind, code, name, parentCode: null, isActive: true }), 0, 'setup']);
const employeeDoc = (no, name, profileId) => JSON.stringify({ employeeNo: no, name, profileId, hireDate: '2020-01-01', siteId: null, department: 'D1', grade: 'STAFF', position: 'MEMBER' });
const active = await rpc('hr_create_employee', [company, employeeDoc('E1', '재직자', null), 'setup']);
const terminated = await rpc('hr_create_employee', [company, employeeDoc('E2', '퇴사자', oldAccount), 'setup']);
const futureExit = await rpc('hr_create_employee', [company, employeeDoc('E3', '퇴사예정', null), 'setup']);
const today = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text d")).rows[0].d;
const tomorrow = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+1)::text d")).rows[0].d;
const dayAfter = (await db.query("select ((now() at time zone 'Asia/Seoul')::date+2)::text d")).rows[0].d;
await rpc('hr_record_personnel_action', [company, terminated, 1, JSON.stringify({ type: 'terminate', effectiveDate: today, siteId: null, department: 'D1', grade: 'STAFF', position: 'MEMBER', reason: '퇴사' })]);
await rpc('hr_record_personnel_action', [company, futureExit, 1, JSON.stringify({ type: 'terminate', effectiveDate: tomorrow, siteId: null, department: 'D1', grade: 'STAFF', position: 'MEMBER', reason: '퇴사 예정' })]);
await db.exec('reset role');
const migration = 'supabase/migrations/20260915000800_hr_employment_cycles.sql';
if (fs.existsSync(migration)) await db.exec(fs.readFileSync(migration, 'utf8'));
await login();
const history = (employee) => rpc('hr_employment_history', [company, employee]);
const prepare = (employee) => rpc('hr_prepare_rehire', [company, employee]);
const rehire = (employee, revision, hireDate, accountMode = 'keep', profileId = null) =>
    rpc('hr_create_reemployment', [company, employee, revision, JSON.stringify({ hireDate, siteId: null, department: 'D1', grade: 'STAFF', position: 'TEAM_LEAD', accountMode, profileId }), '재입사 승인']);
const cancelEmployment = (employee, employment, revision, reason = '재입사 취소') => rpc('hr_cancel_planned_employment', [company, employee, employment, revision, reason]);

await db.exec('reset role');
eq((await db.query('select count(*)::int c from public.hr_employment_cycles')).rows[0].c, 3);
eq((await db.query('select count(*)::int c from public.hr_personnel_actions where employment_id is not null')).rows[0].c, 2);
await login();
let result = await history(terminated);
eq(result.companyId, company);
eq(result.employeeId, terminated);
eq(result.employments.length, 1);
eq(result.employments[0].sequenceNo, 1);
eq(result.employments[0].endDate, today);
eq(result.employments[0].status, 'terminated');
await fails(() => rpc('hr_correct_employee', [company, terminated, 2, JSON.stringify({ name: '퇴사자', hireDate: '2020-01-02' }), 'old contract']), '22023', 'invalid_correction');
eq((await prepare(active)).eligible, false);
eq((await prepare(terminated)).eligible, true);
eq((await prepare(terminated)).earliestHireDate, tomorrow);
eq((await prepare(futureExit)).earliestHireDate, dayAfter);
eq((await prepare(terminated)).accountCandidates.find((x) => x.id === newAccount).preview, { level: 1, source: 'grade' });

await fails(() => rehire(active, 1, tomorrow), '22023', 'rehire_not_allowed');
await fails(() => rehire(terminated, 2, today), '22023', 'employment_overlap');
await fails(() => rehire(terminated, 99, tomorrow), '40001');
await fails(() => rehire(terminated, 2, tomorrow, 'replace', admin), '22023', 'account_unavailable');
result = await rehire(terminated, 2, tomorrow, 'replace', newAccount);
eq(result.employments.length, 2);
eq(result.employments[1].sequenceNo, 2);
eq(result.employments[1].status, 'planned');
eq(result.employments[1].accountChanged, true);
eq((await asOwner('select profile_id from public.hr_employees where id=$1', [terminated])).rows[0].profile_id, newAccount);
eq((await asOwner('select count(*)::int c from public.hr_employee_account_links where employee_id=$1', [terminated])).rows[0].c, 1);
await fails(() => rehire(terminated, 3, dayAfter), '22023', 'rehire_not_allowed');
const planned = result.employments[1].id;
eq((await asOwner('select private.hr_active_employment($1,$2,$3::date) e', [company, terminated, tomorrow])).rows[0].e, planned);
await login(newAccount);
const beforeHire = await rpc('enterprise_access_context', [company]);
eq(beforeHire.companyId, null);
eq(beforeHire.menuKeys, []);
await login();
result = await cancelEmployment(terminated, planned, 3);
eq(result.employments[1].cancelled, true);
eq((await asOwner('select profile_id from public.hr_employees where id=$1', [terminated])).rows[0].profile_id, oldAccount);
eq((await asOwner('select count(*)::int c from public.hr_employee_account_links where employee_id=$1', [terminated])).rows[0].c, 2);
await fails(() => cancelEmployment(terminated, planned, 4), '22023', 'planned_employment_required');

result = await rehire(terminated, 4, tomorrow, 'keep');
eq(result.employments.at(-1).status, 'planned');
const secondPlanned = result.employments.at(-1).id;
const terminationAction = (await history(futureExit)).employments[0].actions.find((x) => x.type === 'terminate').id;
await rehire(futureExit, 2, dayAfter, 'keep');
await fails(() => rpc('hr_cancel_personnel_action', [company, futureExit, terminationAction, 3, '퇴사 취소']), '22023', 'future_employment_exists');

await login(admin);
let settings = await rpc('hr_module_settings', [company]);
ok(settings.modules[0].pendingActions >= 3);
await rpc('hr_save_module_settings', [company, 'hr.core', 0, 'draining', true, '정리']);
await login();
result = await cancelEmployment(terminated, secondPlanned, 5);
eq(result.employments.at(-1).cancelled, true);
await fails(() => rehire(terminated, 6, tomorrow));
await login(admin);
await fails(() => rpc('hr_save_module_settings', [company, 'hr.core', 1, 'read_only', true, '읽기 전용']), '22023', 'module_pending_actions');
await rpc('hr_save_module_settings', [company, 'hr.core', 1, 'enabled', true, '재개']);
await login();

// A later explicit account edit wins over automatic cancellation restoration.
result = await rehire(terminated, 6, tomorrow, 'replace', newAccount);
const changedPlanned = result.employments.at(-1).id;
await rpc('hr_link_employee_account', [company, terminated, 7, spare, '예약 후 별도 계정 변경']);
result = await cancelEmployment(terminated, changedPlanned, 8);
eq((await asOwner('select profile_id from public.hr_employees where id=$1', [terminated])).rows[0].profile_id, spare);
eq(result.employments.at(-1).cancelled, true);
await fails(() => cancelEmployment(terminated, result.employments[0].id, 9), '22023', 'planned_employment_required');
await login(spare);
await fails(() => history(terminated));
await fails(() => prepare(terminated));
await login(admin);
await fails(() => history(terminated));
await db.exec('reset role');
eq((await db.query("select count(*)::int c from information_schema.role_table_grants where table_name='hr_employment_cycles' and grantee='authenticated'")).rows[0].c, 0);
await db.exec('set role authenticated');
await fails(() => db.query('select * from public.hr_employment_cycles'), '42501');
await db.exec('reset role');
console.log(`HR employment cycles: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
