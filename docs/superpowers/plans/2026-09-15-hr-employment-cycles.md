# HR Employment Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every hire and rehire as a separate employment cycle while applying ERP access only from the cycle active on the current Seoul date.

**Architecture:** Migration 008 backfills one employment cycle per existing employee, connects personnel actions to cycles, and replaces state/authorization RPCs around the active cycle. A focused repository validates RPC documents, and an `EmployeeEmployment.vue` component owns the history, rehire review, and planned-cycle cancellation flow inside the existing employee detail page.

**Tech Stack:** PostgreSQL/Supabase security-definer RPC and RLS, PGlite runtime verification, Vue 3 Composition API, PrimeVue, Vitest and Vue Test Utils.

**Spec:** `docs/superpowers/specs/2026-09-15-hr-employment-cycles-design.md`

## Global Constraints

- Seoul calendar date determines planned, active and terminated states.
- One employee identity retains one immutable employee number across all cycles.
- Employment periods for an employee never overlap; same-day termination and rehire is invalid.
- Existing employees and actions migrate to cycle 1 without losing audit data.
- Rehire account handling is exactly `keep | unlink | replace`; `replace` requires an eligible profile UUID.
- Future rehire creates no access before its hire date.
- Rehire creation requires `hr.core/read/company` and `hr.core/update/company` while the module is `enabled`.
- Planned-cycle cancellation requires original read/update grants and is allowed in `enabled` or `draining`.
- No direct table grants, technical-admin business bypass, production DB apply, deployment, new dependency, or site-scoped HR authorization.
- UI fields have visible labels, inline feedback and saving state; layout has no horizontal overflow at 375px.
- Client errors expose only the documented Korean messages.

---

### Task 1: Employment cycle schema, backfill and server invariants

**Files:**
- Create: `supabase/migrations/20260915000800_hr_employment_cycles.sql`
- Create: `supabase/tests/hr_employment_cycles.pglite.mjs`
- Modify: `supabase/migrations/enterprise_access_policy.test.js`

**Interfaces:**
- Consumes: `private.hr_authorize(uuid,text)`, `private.enterprise_granted(uuid,text,text,text,uuid)`, `private.hr_preview_level(uuid,uuid,text,text)`, `private.hr_link_candidates(uuid,uuid)`.
- Produces: `private.hr_active_employment(uuid,uuid,date)`, replaced `private.hr_employee_state(uuid,uuid)`, and public RPCs:
  - `hr_employment_history(uuid,uuid) returns jsonb`
  - `hr_prepare_rehire(uuid,uuid) returns jsonb`
  - `hr_create_reemployment(uuid,uuid,integer,jsonb,text) returns jsonb`
  - `hr_cancel_planned_employment(uuid,uuid,uuid,integer,text) returns jsonb`

- [ ] **Step 1: Write the failing migration runtime test**

Create a PGlite harness that loads all migration files lower than `20260915000800`, publishes an HR policy, creates active, terminated and future-termination employees, then attempts to load migration 008. Assert the expected post-migration interfaces:

```js
+const history = (employee) => rpc('hr_employment_history', [company, employee]);
+const prepare = (employee) => rpc('hr_prepare_rehire', [company, employee]);
+const rehire = (employee, revision, document, reason = '재입사') =>
+    rpc('hr_create_reemployment', [company, employee, revision, JSON.stringify(document), reason]);
+const cancelEmployment = (employee, employment, revision, reason = '재입사 취소') =>
+    rpc('hr_cancel_planned_employment', [company, employee, employment, revision, reason]);
+
+eq((await history(terminated)).employments[0].sequenceNo, 1);
+eq((await prepare(active)).eligible, false);
+eq((await prepare(terminated)).earliestHireDate, dayAfterTermination);
+```

Add assertions for: cycle-1 backfill; action `employment_id` backfill; earliest hire date; future rehire; same-day/overlap rejection; second pending rehire rejection; current-state access before/on hire date; position-before-grade preview; `keep`, `unlink`, `replace`; unavailable account; revision conflict; old-cycle action isolation; future rehire cancellation; cancellation after hire rejection; termination cancellation blocked by pending rehire; module `draining` cancellation; read-only/disabled denial; pending-module count; RLS; five audit fields.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node supabase/tests/hr_employment_cycles.pglite.mjs
```

Expected: failure because `hr_employment_history` or migration 008 does not exist.

- [ ] **Step 3: Add the cycle schema and deterministic backfill**

Create `public.hr_employment_cycles` with:

```sql
id uuid primary key default gen_random_uuid(),
company_id uuid not null,
employee_id uuid not null,
sequence_no integer not null check(sequence_no > 0),
hire_date date not null,
end_date date,
site_id uuid,
department text not null,
grade text not null,
position text not null,
revision integer not null default 1 check(revision > 0),
reason text not null check(length(btrim(reason)) between 1 and 2000),
created_by uuid not null references public.profiles(id),
created_at timestamptz not null default now(),
updated_by uuid not null references public.profiles(id),
updated_at timestamptz not null default now(),
cancelled_at timestamptz,
cancelled_by uuid references public.profiles(id),
cancellation_reason text,
unique(company_id, employee_id, sequence_no),
unique(company_id, id),
foreign key(company_id, employee_id) references public.hr_employees(company_id, id),
foreign key(company_id, site_id) references public.sites(company_id, id)
```

Require `end_date is null or end_date > hire_date` and all-or-none cancellation audit fields. Enable RLS and revoke table access. Insert cycle 1 from every `hr_employees` row, using the earliest uncancelled terminate action as `end_date`. Add nullable `employment_id` to `hr_personnel_actions`, backfill it to cycle 1, then make it non-null and add `(company_id,employment_id)` foreign key.

- [ ] **Step 4: Replace state and action functions**

Implement `private.hr_active_employment` to choose the uncancelled cycle whose `hire_date <= as_of` and `end_date is null or end_date > as_of`, ordered by sequence descending. Replace `private.hr_employee_state` so no active cycle returns status `planned` only when the next uncancelled cycle is future, otherwise `terminated`; active assignment uses transfers with the same `employment_id`.

Replace personnel-action creation so it writes the latest applicable employment ID and updates its `end_date` for termination. Replace cancellation so a termination cannot be cancelled while a later uncancelled cycle exists and successful cancellation clears that cycle's `end_date`.

- [ ] **Step 5: Implement history, preparation, rehire and cancellation RPCs**

Return these exact documents:

```js
{
  companyId, employeeId, employeeRevision,
  permissions: { create: boolean, cancel: boolean },
  employments: [{
    id, sequenceNo, hireDate, endDate, status,
    siteId, department, grade, position, cancelled,
    cancellationReason, actions: []
  }]
}
```

```js
{
  companyId, employeeId, employeeRevision,
  eligible, earliestHireDate,
  currentAccount: null | { id, name },
  accountCandidates: [{ id, name, preview: { level, source } }],
  sites: [{ id, name }],
  references: [{ id, kind, code, name }],
  permissions: { create: boolean }
}
```

Validate the rehire document with exact keys:

```json
{"hireDate":"2026-10-01","siteId":null,"department":"D1","grade":"G1","position":"P1","accountMode":"keep","profileId":null}
```

For `replace`, require a candidate and update `hr_employees.profile_id`; for `unlink`, set it null; for `keep`, require `profileId: null` and retain it. Insert an `hr_employee_account_links` audit row only when the profile changes. Increment employee revision for create and cancel. Cancellation marks the latest future cycle cancelled and preserves it in history.

Replace `private.hr_module_pending` to sum future uncancelled personnel actions and future uncancelled cycles. Add a cancellation authorizer that permits `enabled` or `draining` with raw read/update grants.

- [ ] **Step 6: Lock down functions and verify GREEN**

Set private/public function owners to `postgres`, revoke all private execution, revoke public execution from `public,anon,authenticated`, then grant only the four public RPCs to `authenticated`. Update the registry test to read migration 008 only if a resource registry moves; otherwise leave its 006 pointer intact and add a migration-file existence assertion for 008.

Run:

```powershell
node supabase/tests/hr_employment_cycles.pglite.mjs
node supabase/tests/hr_account_links.pglite.mjs
node supabase/tests/hr_module_settings.pglite.mjs
node supabase/tests/hr_reference_catalog.pglite.mjs
node supabase/tests/hr_employee_ledger.pglite.mjs
```

Expected: every assertion passes and migrations 001–007 remain unchanged.

- [ ] **Step 7: Commit the server slice**

```powershell
git add supabase/migrations/20260915000800_hr_employment_cycles.sql supabase/tests/hr_employment_cycles.pglite.mjs supabase/migrations/enterprise_access_policy.test.js
git commit -m "feat: add HR employment cycle ledger"
```

### Task 2: Strict employment repository contract

**Files:**
- Create: `src/repositories/hr/hrEmploymentRepository.js`
- Create: `src/repositories/hr/hrEmploymentRepository.test.js`

**Interfaces:**
- Consumes: Task 1 public RPC documents.
- Produces: `createHrEmploymentRepository(client)` with `loadHistory`, `prepareRehire`, `createReemployment`, `cancelPlanned`; exports `hrEmploymentErrorMessage(code)`.

- [ ] **Step 1: Write failing repository tests**

Test exact RPC parameter names:

```js
await repo.createReemployment(company, employee, 4, {
  hireDate: '2026-10-01',
  siteId: null,
  department: 'D1',
  grade: 'G1',
  position: 'P1',
  accountMode: 'replace',
  profileId
}, '재입사 승인');

expect(rpc).toHaveBeenLastCalledWith('hr_create_reemployment', {
  target_company: company,
  target_employee: employee,
  expected_revision: 4,
  employment_document: expect.any(Object),
  change_reason: '재입사 승인'
});
```

Reject foreign company/employee IDs, duplicate cycles, invalid dates, sequence zero, inconsistent cancellation fields, unknown preview sources, invalid permission booleans, and malformed history. Verify server messages are sanitized to: `revision_conflict`, `rehire_not_allowed`, `employment_overlap`, `account_unavailable`, `invalid_employment`, `planned_employment_required`, `access_denied`, or generic failure.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest --run src/repositories/hr/hrEmploymentRepository.test.js
```

Expected: import failure because the repository does not exist.

- [ ] **Step 3: Implement strict validators and methods**

Use the UUID/date/text helpers already established in HR repositories. Validate every nested row, require unique employment IDs and sequence numbers, and require candidate/profile consistency. Pass `employment_document` as a JSON-compatible object, not a serialized string, matching existing Supabase client conventions.

- [ ] **Step 4: Run and verify GREEN**

```powershell
npx vitest --run src/repositories/hr/hrEmploymentRepository.test.js
```

Expected: all repository tests pass.

- [ ] **Step 5: Commit the repository slice**

```powershell
git add src/repositories/hr/hrEmploymentRepository.js src/repositories/hr/hrEmploymentRepository.test.js
git commit -m "feat: add HR employment repository"
```

### Task 3: Employment history and rehire interaction

**Files:**
- Create: `src/views/hr/EmployeeEmployment.vue`
- Create: `src/views/hr/employeeEmployment.test.js`
- Modify: `src/views/hr/Employees.vue`
- Modify: `src/views/hr/employees.test.js`

**Interfaces:**
- Consumes: `createHrEmploymentRepository()` from Task 2.
- Produces: `EmployeeEmployment.vue` props `companyId: string`, `employeeId: string`; emits `changed` after successful create/cancel.

- [ ] **Step 1: Write failing mounted tests**

Mock the repository boundary only. Cover:

```js
expect(wrapper.get('[data-testid="employment-cycle-2"]').text()).toContain('2회차');
expect(wrapper.get('[data-testid="employment-cycle-2"]').text()).toContain('재직 예정');
await wrapper.get('[data-testid="rehire-open"]').trigger('click');
await wrapper.get('#rehire-date').setValue('2026-10-01');
await wrapper.get('#rehire-account-mode').setValue('replace');
await wrapper.get('#rehire-profile').setValue(profile);
await wrapper.get('#rehire-reason').setValue('재입사 승인');
await wrapper.get('[data-testid="rehire-review"]').trigger('click');
expect(wrapper.get('[data-testid="rehire-review-panel"]').text()).toContain('레벨 4 · 직책 매핑');
```

Also test visible labels, earliest-date validation, inactive reference rejection, `keep/unlink/replace` conditional account fields, explicit review, saving feedback, server error preservation, planned cancellation confirmation/reason, read-only behavior, and stale response rejection after employee/company/user changes.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest --run src/views/hr/employeeEmployment.test.js
```

Expected: import failure because the component does not exist.

- [ ] **Step 3: Implement the component**

Use one history card per cycle. Keep the full history visible and place the rehire form behind a clear **재입사 등록** button. Use native labeled date/select/textarea controls consistent with existing HR screens. Show inline errors beside the form, `role="status"` for loading/success, and a review panel containing prior end date, new hire date, starting assignment, account transition and preview level.

Use CSS grid:

```css
.rehire-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
@media (max-width: 640px) { .rehire-grid { grid-template-columns: 1fr; } }
```

Buttons remain at least 44px high on touch widths. Do not use animation or a new form dependency; the existing screen uses focused manual validation and adding a validation library for one flow would increase bundle and inconsistency.

- [ ] **Step 4: Integrate into employee detail**

Mount:

```vue
<EmployeeEmployment
  :key="`${company}:${selected.id}`"
  :company-id="company"
  :employee-id="selected.id"
  @changed="employmentChanged"
/>
```

On `changed`, reload the current directory page, refresh runtime access for the still-current identity/company, and reload account-link information through remount or exposed reload. Stub the new component in `employees.test.js` and assert the event causes both reload and runtime refresh without affecting another identity.

- [ ] **Step 5: Run and verify GREEN**

```powershell
npx vitest --run src/views/hr/employeeEmployment.test.js src/views/hr/employees.test.js
```

Expected: all mounted tests pass without Vue warnings.

- [ ] **Step 6: Commit the UI slice**

```powershell
git add src/views/hr/EmployeeEmployment.vue src/views/hr/employeeEmployment.test.js src/views/hr/Employees.vue src/views/hr/employees.test.js
git commit -m "feat: add rehire and employment history UI"
```

### Task 4: Name correction contract and cycle-aware regressions

**Files:**
- Modify: `supabase/migrations/20260915000800_hr_employment_cycles.sql`
- Modify: `src/repositories/hr/hrRepository.js`
- Modify: `src/repositories/hr/hrRepository.test.js`
- Modify: `src/views/hr/Employees.vue`
- Modify: `src/views/hr/employees.test.js`

**Interfaces:**
- Consumes: cycle-1 compatibility from Task 1.
- Produces: `hr_correct_employee` request document `{ name: string }`; correction history keeps `{name, hireDate}` before/after documents.

- [ ] **Step 1: Write failing tests for immutable cycle dates**

Add repository and mounted tests that submit only a trimmed name and never render an editable hire-date field:

```js
expect(wrapper.find('#correct-hire-date').exists()).toBe(false);
await wrapper.get('#correct-name').setValue('김민서');
await wrapper.get('#action-reason').setValue('개명 반영');
await wrapper.get('[data-testid="save-action"]').trigger('submit');
expect(hr.correctEmployee).toHaveBeenCalledWith('employee', 4, { name: '김민서' }, '개명 반영');
```

Add a PGlite assertion that an old-style document containing `hireDate` is rejected as `invalid_correction`.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest --run src/repositories/hr/hrRepository.test.js src/views/hr/employees.test.js
node supabase/tests/hr_employment_cycles.pglite.mjs
```

Expected: current UI still renders and submits `hireDate`.

- [ ] **Step 3: Replace the correction contract**

In migration 008, replace `hr_correct_employee` to accept exact `{name}`, update only `hr_employees.name`, and write correction audit before/after documents with the same unchanged first-cycle `hireDate` for backward-compatible history rendering.

Update repository request tests and remove the date confirmation branch and input from `Employees.vue`. Keep correction-history response validation unchanged.

- [ ] **Step 4: Run and verify GREEN**

Run the commands from Step 2. Expected: all pass.

- [ ] **Step 5: Commit the correction slice**

```powershell
git add supabase/migrations/20260915000800_hr_employment_cycles.sql supabase/tests/hr_employment_cycles.pglite.mjs src/repositories/hr/hrRepository.js src/repositories/hr/hrRepository.test.js src/views/hr/Employees.vue src/views/hr/employees.test.js
git commit -m "refactor: make employment dates cycle-owned"
```

### Task 5: Operational documentation and complete verification

**Files:**
- Create: `docs/setup/hr-employment-cycles.md`
- Modify: `docs/setup/hr-ledger.md`
- Modify: `docs/setup/hr-account-links.md`
- Modify: `docs/setup/hr-modules.md`
- Modify: `docs/HANDOFF.md`
- Modify: this plan to check completed steps.

**Interfaces:**
- Consumes: final SQL and UI behavior.
- Produces: operator migration order, permissions, date semantics, rollback limits, verification evidence.

- [ ] **Step 1: Write operational documentation**

Document migration order 001–008, cycle/status definitions, existing-data backfill, rehire prerequisites, account modes, future access behavior, planned cancellation, module pending behavior, required `hr.core` permissions, and the fact that no production DB apply/deployment occurred.

- [ ] **Step 2: Run full automated verification**

```powershell
npm test -- --run
npx eslint src worker docs supabase --ext .vue,.js,.jsx,.cjs,.mjs --quiet
node supabase/tests/hr_employment_cycles.pglite.mjs
node supabase/tests/hr_account_links.pglite.mjs
node supabase/tests/hr_module_settings.pglite.mjs
node supabase/tests/hr_reference_catalog.pglite.mjs
node supabase/tests/hr_employee_ledger.pglite.mjs
npm run build
```

Expected: all commands exit 0. Record exact test and assertion counts in the setup and handoff documents.

- [ ] **Step 3: Perform real-component visual verification**

Render `EmployeeEmployment.vue` with an existing terminated cycle and a reviewed future rehire. Capture 1440×1000 and 375×900 screenshots with animations disabled. Assert:

```js
{
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  errors: pageErrors
}
```

Expected for both widths: `overflow: false`, `errors: []`. Verify labels, focus visibility, 44px mobile buttons, readable review panel, no clipped account text and no fake controls for unavailable actions.

- [ ] **Step 4: Review and clean the change**

Run `git diff --check`, inspect all changed/untracked files, verify migrations 001–007 are byte-for-byte unchanged, remove temporary preview servers from tracked scope, and ensure no raw database message is displayed.

- [ ] **Step 5: Commit final documentation**

```powershell
git add docs/setup/hr-employment-cycles.md docs/setup/hr-ledger.md docs/setup/hr-account-links.md docs/setup/hr-modules.md docs/HANDOFF.md docs/superpowers/plans/2026-09-15-hr-employment-cycles.md
git commit -m "docs: add employment cycle operations guide"
```

- [ ] **Step 6: Report the local result**

Report commits, exact test counts, SQL assertion counts, build/lint/desktop/mobile results, and state clearly that migration 008 and the app were not applied or deployed to production.
