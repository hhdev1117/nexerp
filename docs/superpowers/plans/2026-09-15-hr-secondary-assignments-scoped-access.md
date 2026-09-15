# HR Secondary Assignments and Scoped Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add effective-dated secondary assignments and grant position-derived permissions only inside each assignment's department scope.

**Architecture:** Migration 009 adds an RPC-only secondary-assignment ledger, connects it to employment-cycle and module invariants, and introduces target-aware access evaluation without changing the existing company-wide helper contract. A focused repository validates the new RPC documents, and a dedicated Vue component manages history, creation, ending, and future cancellation inside the employee detail screen.

**Tech Stack:** PostgreSQL/Supabase security-definer RPC and RLS, PGlite runtime verification, Vue 3 Composition API, PrimeVue, Vitest and Vue Test Utils.

**Spec:** `docs/superpowers/specs/2026-09-15-hr-secondary-assignments-scoped-access-design.md`

## Global Constraints

- A secondary assignment stores site, department, position and dates; it never stores a separate grade.
- Dates use Seoul calendar days and `[start_date, end_date)` intervals.
- The assignment must remain inside its employment cycle and may not equal the effective primary department.
- Different departments may overlap; the same department in the same employment cycle may not overlap.
- A secondary position never changes the user's base level.
- Derived permissions are capped to the assignment department; `organization_tree` includes its current active descendants.
- Individual deny rules remain stronger than primary, role and secondary-assignment allows.
- Future assignment cancellation is allowed only before its start date; an effective assignment is ended instead.
- Create and end require `hr.core/read/company` and `hr.core/update/company` with the module `enabled`; future cancellation also permits `draining`.
- No direct table grants, technical-admin business bypass, production DB apply, deployment, new dependency, or client-only authorization.
- Every input has a visible associated label, inline error, saving state, and a mobile target height of at least 44px.

---

### Task 1: Secondary-assignment ledger and employment invariants

**Files:**
- Create: `supabase/migrations/20260915000900_hr_secondary_assignments.sql`
- Create: `supabase/tests/hr_secondary_assignments.pglite.mjs`
- Modify: `supabase/migrations/enterprise_access_policy.test.js`

**Interfaces:**
- Consumes: `private.hr_active_employment(uuid,uuid,date)`, `private.hr_employee_state(uuid,uuid)`, `private.hr_validate_assignment(uuid,jsonb,boolean)`, `private.hr_module_pending(uuid,text)`.
- Produces: `public.hr_secondary_assignments`, `private.hr_secondary_status(date,date,date,timestamptz)`, and public RPCs `hr_secondary_assignment_history`, `hr_prepare_secondary_assignment`, `hr_create_secondary_assignment`, `hr_end_secondary_assignment`, `hr_cancel_secondary_assignment`.

- [ ] **Step 1: Write the failing PostgreSQL runtime test**

Load every migration lower than 009, create an enabled HR company, published position mappings, active/terminated/planned employment cycles, and active department hierarchy `HQ > DEV > DEV1`. Add helpers with exact RPC argument order:

```js
const history = (employee) => rpc('hr_secondary_assignment_history', [company, employee]);
const prepare = (employee) => rpc('hr_prepare_secondary_assignment', [company, employee]);
const createSecondary = (employee, revision, document, reason = '겸직 등록') =>
    rpc('hr_create_secondary_assignment', [company, employee, revision, JSON.stringify(document), reason]);
const endSecondary = (employee, assignment, employeeRevision, assignmentRevision, endDate, reason = '겸직 종료') =>
    rpc('hr_end_secondary_assignment', [company, employee, assignment, employeeRevision, assignmentRevision, endDate, reason]);
const cancelSecondary = (employee, assignment, employeeRevision, assignmentRevision, reason = '예정 취소') =>
    rpc('hr_cancel_secondary_assignment', [company, employee, assignment, employeeRevision, assignmentRevision, reason]);
```

Assert these concrete invariants:

```js
const created = await createSecondary(activeEmployee, 1, {
    employmentId: activeEmployment,
    siteId: mainSite,
    department: 'DEV',
    position: 'TEAM_LEAD',
    startDate: tomorrow,
    endDate: null
});
eq(created.assignments[0].status, 'planned');
eq(created.assignments[0].grade, 'STAFF');
await rejects(() => createSecondary(activeEmployee, 2, {
    employmentId: activeEmployment,
    siteId: mainSite,
    department: 'DEV',
    position: 'MEMBER',
    startDate: tomorrow,
    endDate: dayAfterTomorrow
}), 'secondary_overlap');
```

Cover different-department overlap, primary-department conflict on creation and transfer, dates outside the employment cycle, exact document keys, inactive references, future cancellation, started-assignment cancellation rejection, immediate/future ending, revision conflict, termination auto-end, termination-cancel no reopen, rehire isolation, module pending count, draining cancellation, read-only/disabled denial, company boundary, RLS, and all audit fields.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
node supabase/tests/hr_secondary_assignments.pglite.mjs
```

Expected: failure because migration 009 and `hr_secondary_assignment_history` do not exist.

- [ ] **Step 3: Add the table, constraints and status helper**

Create `hr_secondary_assignments` with this contract:

```sql
create table public.hr_secondary_assignments(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 employee_id uuid not null,
 employment_id uuid not null,
 site_id uuid not null,
 department text not null,
 position text not null,
 start_date date not null,
 end_date date,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 revision integer not null default 1 check(revision > 0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 ended_by uuid references public.profiles(id),
 ended_at timestamptz,
 end_reason text,
 cancelled_by uuid references public.profiles(id),
 cancelled_at timestamptz,
 cancellation_reason text,
 unique(company_id,id),
 foreign key(company_id,employee_id) references public.hr_employees(company_id,id),
 foreign key(company_id,employment_id) references public.hr_employment_cycles(company_id,id),
 foreign key(company_id,site_id) references public.sites(company_id,id),
 check(end_date is null or end_date > start_date)
);
```

Add all-or-none checks for ending and cancellation audit triples. Enable RLS, revoke all table access, and create a GiST exclusion constraint over `(company_id, employment_id, department, daterange(start_date,end_date,'[)'))` for uncancelled rows. Use `btree_gist` only if the extension is already available in the runtime; otherwise enforce overlap under the locked employee row in the RPC and add a supporting B-tree index.

- [ ] **Step 4: Implement history, preparation and write RPCs**

Return history with this exact outer and row shape:

```js
{
  companyId, employeeId, employeeRevision,
  permissions: { create, end, cancel },
  assignments: [{
    id, employmentId, employmentSequence, siteId, department,
    grade, position, startDate, endDate, status, reason,
    endReason, cancellationReason, revision
  }]
}
```

Return preparation with `employeeRevision`, `employmentCycles`, `sites`, active `department` and `position` references, position mappings, primary assignment for the chosen date, and `permissions.create`. Validate exact create keys and UUID/date formats before casting. Lock company, employee and employment rows in that order, then validate module state, published grants, employment bounds, active references, primary-department conflict and overlap.

For ending, require an uncancelled unended assignment and `endDate >= current_date`, `endDate > startDate`, and within the employment end date. For cancellation, require `startDate > current_date`. Increment employee and assignment revisions atomically and return fresh history.

- [ ] **Step 5: Connect primary transfers, termination and reference/module checks**

Replace the 008 versions of the affected functions inside migration 009:

- `hr_record_personnel_action`: reject a transfer when its effective primary department equals an active or planned secondary department on that date; on termination, cap every uncancelled assignment in the employment cycle to the termination date and write ending audit fields.
- `hr_cancel_personnel_action`: retain the capped assignment end dates when a termination is cancelled.
- `private.hr_reference_in_use`: include current and future secondary site/department/position references.
- `private.hr_module_pending`: include future starts and future end dates without double-counting one assignment twice; count each assignment once when either future boundary exists.

- [ ] **Step 6: Lock down and verify GREEN**

Set function owners, fixed `search_path`, revoke all public execution, and grant only the five public RPCs to `authenticated`. Run:

```powershell
node supabase/tests/hr_secondary_assignments.pglite.mjs
node supabase/tests/hr_employment_cycles.pglite.mjs
node supabase/tests/hr_module_settings.pglite.mjs
node supabase/tests/hr_reference_catalog.pglite.mjs
node supabase/tests/hr_employee_ledger.pglite.mjs
npm test -- --run supabase/migrations/enterprise_access_policy.test.js
```

Expected: every suite passes and migrations 001–008 remain byte-for-byte unchanged.

- [ ] **Step 7: Commit the ledger slice**

```powershell
git add supabase/migrations/20260915000900_hr_secondary_assignments.sql supabase/tests/hr_secondary_assignments.pglite.mjs supabase/migrations/enterprise_access_policy.test.js
git commit -m "feat: add effective-dated secondary assignments"
```

---

### Task 2: Target-aware scoped access engine

**Files:**
- Modify: `supabase/migrations/20260915000900_hr_secondary_assignments.sql`
- Modify: `supabase/tests/hr_secondary_assignments.pglite.mjs`
- Create: `src/data/scopedAccess.js`
- Create: `src/data/scopedAccess.test.js`

**Interfaces:**
- Consumes: published policy JSON, `private.hr_active_employment`, active department `parent_code` hierarchy, and `hr_secondary_assignments` from Task 1.
- Produces: `private.enterprise_granted_for_target(uuid,text,text,uuid,text) returns boolean`, `enterprise_explain_scoped_access(uuid,uuid,date,text,text,uuid,text) returns jsonb`, and client pure helpers `secondaryScopeMatches()` and `scopedAccessLabel()`.

- [ ] **Step 1: Write failing pure-domain and SQL assertions**

Create `scopedAccess.test.js` with exact boundary cases:

```js
expect(secondaryScopeMatches({ policyScope: 'organization', assignmentDepartment: 'DEV', descendants: ['DEV1'], targetDepartment: 'DEV', assignmentSiteId: site, targetSiteId: site })).toBe(true);
expect(secondaryScopeMatches({ policyScope: 'organization', assignmentDepartment: 'DEV', descendants: ['DEV1'], targetDepartment: 'DEV1', assignmentSiteId: site, targetSiteId: site })).toBe(false);
expect(secondaryScopeMatches({ policyScope: 'organization_tree', assignmentDepartment: 'DEV', descendants: ['DEV1'], targetDepartment: 'DEV1', assignmentSiteId: site, targetSiteId: site })).toBe(true);
expect(secondaryScopeMatches({ policyScope: 'site', assignmentDepartment: 'DEV', descendants: ['DEV1'], targetDepartment: 'DEV1', assignmentSiteId: site, targetSiteId: otherSite })).toBe(false);
```

Extend the PGlite test so a level-1 employee with a `TEAM_LEAD -> level 4` secondary assignment keeps base level 1, gains a level-4 action in `DEV` and `DEV1`, is denied in a sibling department and other site, loses access at `end_date`, and is denied by a matching individual override.

- [ ] **Step 2: Run both tests and verify RED**

```powershell
npm test -- --run src/data/scopedAccess.test.js
node supabase/tests/hr_secondary_assignments.pglite.mjs
```

Expected: missing module/function failures.

- [ ] **Step 3: Implement the pure scope predicate**

Export a strict predicate accepting only `organization`, `organization_tree`, and `site` as secondary-derived scopes. `company` is normalized to `organization_tree`; `self` and `assigned` return false. Require target department for every secondary match, and require matching site for `site`.

```js
export function secondaryScopeMatches(input) {
    const scope = input.policyScope === 'company' ? 'organization_tree' : input.policyScope;
    if (!['organization', 'organization_tree', 'site'].includes(scope) || !input.targetDepartment) return false;
    const inTree = input.targetDepartment === input.assignmentDepartment || input.descendants.includes(input.targetDepartment);
    if (scope === 'organization') return input.targetDepartment === input.assignmentDepartment;
    if (scope === 'site') return inTree && input.targetSiteId === input.assignmentSiteId;
    return inTree;
}
```

- [ ] **Step 4: Implement server target evaluation and explanation**

Keep `private.enterprise_granted` unchanged. Add a recursive active-department descendant helper with cycle-safe visited codes. `enterprise_granted_for_target` must first evaluate existing base/role/override grants for the exact target, then evaluate active secondary assignments for the caller's employee and employment cycle. Convert a level permission with `company` to an assignment `organization_tree` cap; reject secondary derivation for `self` and `assigned`. Apply matching deny overrides after collecting every allow.

The explanation RPC returns:

```js
{
  allowed: true,
  baseLevel: { level: 1, source: 'grade' },
  target: { siteId, department: 'DEV1' },
  sources: [{ type: 'secondary', assignmentId, position: 'TEAM_LEAD', level: 4, department: 'DEV', scope: 'organization_tree' }],
  denies: []
}
```

Require the caller to be the requested profile or hold published `settings.enterprise-access/read/company`. Never reveal another company's assignment or policy details.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- --run src/data/scopedAccess.test.js supabase/migrations/enterprise_access_policy.test.js
node supabase/tests/hr_secondary_assignments.pglite.mjs
git add src/data/scopedAccess.js src/data/scopedAccess.test.js supabase/migrations/20260915000900_hr_secondary_assignments.sql supabase/tests/hr_secondary_assignments.pglite.mjs
git commit -m "feat: evaluate department-scoped secondary access"
```

---

### Task 3: Strict secondary-assignment repository

**Files:**
- Create: `src/repositories/hr/hrSecondaryAssignmentRepository.js`
- Create: `src/repositories/hr/hrSecondaryAssignmentRepository.test.js`

**Interfaces:**
- Consumes: the five Task 1 RPCs and `enterprise_explain_scoped_access` from Task 2.
- Produces: `createHrSecondaryAssignmentRepository(client?)` with `loadHistory`, `prepare`, `create`, `end`, `cancel`, and `explainAccess` methods.

- [ ] **Step 1: Write failing repository tests**

Use a queued Supabase RPC mock and assert exact names and arguments:

```js
await repository.create(company, employee, 4, {
    employmentId, siteId, department: 'DEV', position: 'TEAM_LEAD',
    startDate: '2026-10-01', endDate: null
}, '개발팀장 겸직');
expect(client.rpc).toHaveBeenCalledWith('hr_create_secondary_assignment', {
    target_company: company,
    target_employee: employee,
    expected_employee_revision: 4,
    assignment_document: expect.any(Object),
    change_reason: '개발팀장 겸직'
});
```

Reject malformed UUIDs, dates, statuses, missing grade in history, unknown permission sources, duplicate assignment IDs, and extra/missing response fields. Assert provider text does not escape for `secondary_overlap`, `primary_assignment_conflict`, `employment_bounds`, `revision_conflict`, `access_denied`, `module_not_writable`, `planned_assignment_required`, and generic failures.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- --run src/repositories/hr/hrSecondaryAssignmentRepository.test.js
```

Expected: module import failure.

- [ ] **Step 3: Implement validators, methods and Korean error mapping**

Validate every outer object and nested array before returning. Pass create documents as JSON-compatible objects, trim reasons, and map only allowlisted server codes to stable Korean messages. `explainAccess` accepts `{profileId, asOf, resource, action, siteId, department}` and validates the exact explanation document produced in Task 2.

- [ ] **Step 4: Run and commit**

```powershell
npm test -- --run src/repositories/hr/hrSecondaryAssignmentRepository.test.js
git add src/repositories/hr/hrSecondaryAssignmentRepository.js src/repositories/hr/hrSecondaryAssignmentRepository.test.js
git commit -m "feat: add secondary assignment repository"
```

---

### Task 4: Employee secondary-assignment UI

**Files:**
- Create: `src/views/hr/EmployeeSecondaryAssignments.vue`
- Create: `src/views/hr/employeeSecondaryAssignments.test.js`
- Modify: `src/views/hr/Employees.vue`
- Modify: `src/views/hr/employees.test.js`

**Interfaces:**
- Consumes: `createHrSecondaryAssignmentRepository()` and props `{companyId:string, employeeId:string}`.
- Produces: `EmployeeSecondaryAssignments` with `changed` event after create/end/cancel.

- [ ] **Step 1: Write failing mounted tests**

Mock auth and the Task 3 repository. Cover:

```js
expect(wrapper.get('[data-testid="secondary-assignment-active"]').text()).toContain('개발팀');
await wrapper.get('[data-testid="secondary-create-open"]').trigger('click');
await wrapper.get('#secondary-start-date').setValue('2026-10-01');
await wrapper.get('#secondary-site').setValue(siteId);
await wrapper.get('#secondary-department').setValue('DEV');
await wrapper.get('#secondary-position').setValue('TEAM_LEAD');
await wrapper.get('#secondary-reason').setValue('개발팀장 겸직');
await wrapper.get('[data-testid="secondary-review"]').trigger('click');
expect(wrapper.get('[data-testid="secondary-review-panel"]').text()).toContain('개발팀 및 하위 조직');
```

Also test field-level date/department errors and first-invalid focus, unmapped-position warning, disabled saving controls, future cancellation confirmation, active ending, read-only rendering, stale response disposal after employee/auth change, and `changed` emission.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- --run src/views/hr/employeeSecondaryAssignments.test.js
```

Expected: component import failure.

- [ ] **Step 3: Implement the focused component**

Render history grouped by employment sequence with textual status labels. Keep the full list visible and progressively reveal one editor at a time: create, end, or cancel. Use native labeled date/select/textarea controls consistent with the existing HR screens. Maintain an `errors` object keyed by field ID, connect messages with `aria-describedby`, focus the first invalid field after submit, and show a frozen review object before writing.

Preview text must state the unchanged primary grade and the capped scope, for example `개인 직급 대리 유지 · 겸직 직책 레벨 4 · 개발팀 및 하위 조직`. Use `role="status"` for loading/success and `role="alert"` for failures. At 640px and below use one column and `min-height:44px` for controls.

- [ ] **Step 4: Integrate with employee detail**

Mount the new component after `EmployeeEmployment` and before `EmployeeAccount`. Increment the existing detail refresh version after a secondary change so employment, account and permission previews reload. Ensure changing company, employee or user closes every draft and prevents late responses from updating the new selection.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- --run src/views/hr/employeeSecondaryAssignments.test.js src/views/hr/employees.test.js src/views/hr/employeeEmployment.test.js src/views/hr/employeeAccount.test.js
git add src/views/hr/EmployeeSecondaryAssignments.vue src/views/hr/employeeSecondaryAssignments.test.js src/views/hr/Employees.vue src/views/hr/employees.test.js
git commit -m "feat: manage secondary assignments in employee details"
```

---

### Task 5: Operations documentation and full verification

**Files:**
- Create: `docs/setup/hr-secondary-assignments.md`
- Modify: `docs/setup/hr-ledger.md`
- Modify: `docs/setup/hr-modules.md`
- Modify: `docs/setup/enterprise-access.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-15-hr-secondary-assignments-scoped-access.md`

**Interfaces:**
- Consumes: the completed database, repository, access and UI slices.
- Produces: migration order, permission semantics, shutdown rules, verification evidence, and checked plan steps.

- [ ] **Step 1: Write the operational guide**

Document migration order 001–009, `[start,end)` date semantics, primary-grade reuse, same-department overlap rule, current hierarchy scope, create/end/cancel permissions, draining behavior, termination auto-end, deny precedence, and the requirement that future persistent business RPCs call `enterprise_granted_for_target`. State that migration 009 and the app were not applied or deployed to production.

- [ ] **Step 2: Run full automated verification**

```powershell
npm test -- --run
npx eslint src worker docs supabase --ext .vue,.js,.jsx,.cjs,.mjs --quiet
node supabase/tests/hr_secondary_assignments.pglite.mjs
node supabase/tests/hr_employment_cycles.pglite.mjs
node supabase/tests/hr_account_links.pglite.mjs
node supabase/tests/hr_module_settings.pglite.mjs
node supabase/tests/hr_reference_catalog.pglite.mjs
node supabase/tests/hr_employee_ledger.pglite.mjs
npm run build
```

Expected: every command exits zero. Record exact test and assertion counts from the output rather than copying earlier counts.

- [ ] **Step 3: Perform real-component visual verification**

Render `EmployeeSecondaryAssignments.vue` with the real PrimeVue theme and mocked repository data at 1440×1000, 375×900, and 812×375. Exercise create review, active end review and future cancellation. Assert no browser page errors, no document-level horizontal overflow, visible focus, associated labels, and at least 44px control height on 375px. Store screenshots only under ignored `.cache/ui-preview/`.

- [ ] **Step 4: Review scope and migration safety**

Run `git diff --check`, inspect the complete 009 migration, confirm 001–008 are unchanged, verify every security-definer function has a fixed search path and explicit grants, and confirm no production command, credential, generated `dist`, or `.cache` artifact is staged.

- [ ] **Step 5: Complete the plan and commit documentation**

Mark every completed checkbox `[x]`, then run:

```powershell
git add docs/setup/hr-secondary-assignments.md docs/setup/hr-ledger.md docs/setup/hr-modules.md docs/setup/enterprise-access.md docs/HANDOFF.md docs/superpowers/plans/2026-09-15-hr-secondary-assignments-scoped-access.md
git commit -m "docs: add secondary assignment operations guide"
```

- [ ] **Step 6: Report the local result**

Report the migration and UI behavior, exact verification counts, visual sizes, branch and commit list, and that production DB application and deployment remain separate operations.
