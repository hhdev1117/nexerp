# Unified Partner Master Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicate customer and vendor maintenance menus with one company-scoped Supabase partner master that administrators edit and other active users read.

**Architecture:** Extend the existing master repository and store contracts with partner records, add a dedicated PrimeVue management view, and retain old URLs as redirects. A new PostgreSQL migration owns validation, RLS, audit behavior, inactive-company enforcement, and role-menu permission migration.

**Tech Stack:** Vue 3, Vue Router, PrimeVue 4, Supabase Postgres/Auth/RLS, Cloudflare Workers Static Assets, Vitest, pgTAP

**Spec:** `docs/superpowers/specs/2026-09-14-partner-master-design.md`

## Global Constraints

- A partner always belongs to exactly one `company_id`.
- A partner must have at least one of `is_customer` or `is_vendor` set to true.
- Active MFA-verified users may read; only active MFA-verified administrators may insert or update.
- Records are deactivated, never physically deleted through the application.
- Inactive companies cannot receive new active partners or reactivate existing partners.
- Existing `sales.customers` or `purchasing.vendors` permission grants must preserve access through `master.partners`.
- Existing `/sales/customers` and `/purchasing/vendors` links must redirect to `/master/partners`.
- Provider errors and database details must not be exposed to users.

---

### Task 1: Partner Domain Contract And Menu Consolidation

**Files:**
- Modify: `src/data/master.js`
- Modify: `src/data/master.test.js`
- Modify: `src/data/erp.js`
- Modify: `src/data/erp.test.js`
- Modify: `src/router/index.js`
- Modify: `src/router/erp-router.test.js`

**Interfaces:**
- Produces: `normalizeBusinessNumber(value)`, `validatePartnerDraft(draft)`, one `master.partners` menu entry, and redirects from the two legacy paths.
- Consumes: existing `MASTER_CODE_PATTERN`, `normalizeCode`, `erpMenu`, and `flattenMenuRoutes`.

- [ ] **Step 1: Write failing domain and routing tests**

Add assertions that `normalizeBusinessNumber('120-88-12345')` returns `1208812345`, and that `validatePartnerDraft` flags an empty company, invalid code, blank name, no role, malformed optional business number, and malformed optional email. Assert `erpMenu` contains `master.partners` labeled `거래처 관리`, contains neither legacy menu key, and router source defines redirects for both legacy URLs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run src/data/master.test.js src/data/erp.test.js src/router/erp-router.test.js`

Expected: FAIL because the validator and redirects do not exist and duplicate menu items remain.

- [ ] **Step 3: Implement the domain helpers and menu changes**

Implement `normalizeBusinessNumber` by removing non-digits. Return `{ errors, isValid }` from `validatePartnerDraft`, with Boolean keys `companyId`, `code`, `name`, `roles`, `businessNumber`, and `email`. Use the existing code pattern, exact ten digits for a supplied business number, and a conservative non-whitespace `local@domain.tld` check for a supplied email. Remove the two legacy menu items, rename the master item, and add top-level router redirect records before the AppLayout route.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run src/data/master.test.js src/data/erp.test.js src/router/erp-router.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/master.js src/data/master.test.js src/data/erp.js src/data/erp.test.js src/router/index.js src/router/erp-router.test.js
git commit -m "refactor: consolidate partner master navigation"
```

### Task 2: Partner Database Schema, RLS, And Permission Migration

**Files:**
- Create: `supabase/migrations/20260914000200_add_partners.sql`
- Create: `supabase/migrations/partners.test.js`
- Create: `supabase/tests/partners_rls.test.sql`

**Interfaces:**
- Produces: `public.partners`, `private.enforce_partner_company_active()`, three RLS policies, audit trigger reuse, and migrated `master.partners` grants.
- Consumes: `public.companies`, `public.profiles`, `public.role_menu_permissions`, `private.is_active_user()`, `private.is_admin()`, and `private.set_master_audit_columns()`.

- [ ] **Step 1: Write the failing migration contract test**

Read the migration as text and assert it contains the table and columns from the spec; unique `(company_id, code)`; partial unique `(company_id, business_number)`; role, code, name, and business-number checks; RLS enablement; authenticated select/insert/update grants without delete; active-user select and admin write policies; audit and active-company triggers; empty function search path; and SQL that unions legacy permission grants into `master.partners` before deleting legacy keys.

- [ ] **Step 2: Run the migration contract test and verify RED**

Run: `npm test -- --run supabase/migrations/partners.test.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the migration**

Create `partners` with UUID/audit defaults matching `companies`. Add `partners_company_code_key`, a partial company/business-number unique index, `partners_company_id_idx`, and checks `code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'`, `btrim(name) <> ''`, `(is_customer or is_vendor)`, and nullable ten-digit business number. Reuse `private.set_master_audit_columns()` and implement a security-definer active-company trigger with `set search_path = ''` and `company_inactive` error.

Migrate permissions with an `insert ... select distinct role, 'master.partners' ... on conflict do nothing` from the three relevant keys, then delete `sales.customers` and `purchasing.vendors`. Do not delete `master.partners` rows.

- [ ] **Step 4: Add pgTAP coverage**

Create 35-plan coverage for table shape, RLS enabled, no delete privilege, active AAL2 user reads, inactive/AAL1 denial, admin insert/update, non-admin write denial, duplicate constraints, missing-role rejection, inactive-company rejection, audit ownership, and permission migration results.

- [ ] **Step 5: Run static and database tests**

Run: `npm test -- --run supabase/migrations/partners.test.js`

Expected: PASS.

When Docker is available, run: `npx supabase test db`

Expected: all pgTAP files PASS. On this PC record Docker absence in `HANDOFF.md` instead of claiming pgTAP passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260914000200_add_partners.sql supabase/migrations/partners.test.js supabase/tests/partners_rls.test.sql
git commit -m "feat: add partner master database security"
```

### Task 3: Repository Contract And Implementations

**Files:**
- Modify: `src/repositories/master/index.js`
- Modify: `src/repositories/master/repository.test.js`
- Modify: `src/repositories/master/errors.js`
- Modify: `src/repositories/master/demoMasterRepository.js`
- Modify: `src/repositories/master/demoMasterRepository.test.js`
- Modify: `src/repositories/master/supabaseMasterRepository.js`
- Modify: `src/repositories/master/supabaseMasterRepository.test.js`

**Interfaces:**
- Produces: repository methods `listPartners()`, `createPartner(draft)`, `updatePartner(id, changes)` returning camel-case partner objects.
- Consumes: Task 1 normalization and Task 2 `partners` table.

- [ ] **Step 1: Write failing repository contract tests**

Extend `MASTER_REPOSITORY_METHODS` expectations with the three partner methods. Test Supabase mapping for `company_id`, `business_number`, `is_customer`, `is_vendor`, audit fields, code ordering, inserts, and partial updates that omit unspecified fields. Test error mapping: unique company/code is `duplicate_code`, unique company/business number is `duplicate_business_number`, `company_inactive`, invalid checks, missing rows, and admin denial.

For the demo repository, seed at least one customer, one vendor, and one dual-role partner. Test company-scoped uniqueness, role requirement, normalized code/business number, inactive-company enforcement, cloning, sorting, and update timestamps.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run src/repositories/master/repository.test.js src/repositories/master/demoMasterRepository.test.js src/repositories/master/supabaseMasterRepository.test.js`

Expected: FAIL because partner methods and mappings do not exist.

- [ ] **Step 3: Implement error and repository behavior**

Add Korean messages for `duplicate_business_number` and a generalized inactive-company message covering sites and partners. Add `PARTNER_FIELDS` and a partner column map to Supabase repository. Distinguish the business-number unique index by provider constraint/details only inside the repository, returning stable application codes.

Extend the demo repository state with partner cloning and the same validation rules as PostgreSQL. `listPartners()` returns code-sorted clones. Create and update must strip identity fields, normalize values, and never mutate values supplied by callers.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/master
git commit -m "feat: add partner master repositories"
```

### Task 4: Partner Store State

**Files:**
- Modify: `src/stores/master.js`
- Modify: `src/stores/master.test.js`

**Interfaces:**
- Produces: `partners`, `activePartners`, `partnersFor(companyId)`, `createPartner(draft)`, and `updatePartner(id, changes)`.
- Consumes: Task 3 partner repository methods.

- [ ] **Step 1: Write failing store tests**

Assert the initial `load()` fetches companies, sites, and partners in parallel; partners are code-sorted; `partnersFor` filters exactly by company; `activePartners` excludes inactive records; create inserts and sorts; update replaces by ID; and stale overlapping loads cannot overwrite newer partner state.

- [ ] **Step 2: Run the focused store test and verify RED**

Run: `npm test -- --run src/stores/master.test.js`

Expected: FAIL because partner state does not exist and repository mocks lack the required calls.

- [ ] **Step 3: Implement partner store state**

Add `partners = ref([])`, include `repository.listPartners()` in the sequenced `Promise.all`, and update all three collections only for the current load sequence. Add computed/filter helpers and create/update actions using the existing `byCode` and `replaceById` helpers.

- [ ] **Step 4: Run the focused store test and verify GREEN**

Run: `npm test -- --run src/stores/master.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/master.js src/stores/master.test.js
git commit -m "feat: add partner master state"
```

### Task 5: Partner Management Screen

**Files:**
- Create: `src/views/master/Partners.vue`
- Create: `src/views/master/partners.test.js`
- Modify: `src/router/index.js`
- Modify: `src/router/erp-router.test.js`

**Interfaces:**
- Produces: dedicated `/master/partners` screen with company, keyword, role, and status filters plus administrator create/edit/status actions.
- Consumes: Task 1 validation helpers and Task 4 master store partner state.

- [ ] **Step 1: Write failing mounted-view tests**

Mount with PrimeVue and mocked auth/toast/confirm adapters. Assert non-admins see rows and the read-only notice but no create/edit/status controls. Assert default selection is the first active company; company switching changes rows; keyword searches code/name/business number; role and status filters combine; no-result copy is visible; and loading/error states are announced.

Open the admin dialog and assert validation prevents save, displays every relevant Korean message, and focuses `partner-company`. Submit a normalized valid dual-role record and assert the store receives camel-case fields. Test editing, confirmation-based deactivate/reactivate, success toasts, repository-error toasts, and form retention on failure.

- [ ] **Step 2: Run the mounted-view test and verify RED**

Run: `npm test -- --run src/views/master/partners.test.js src/router/erp-router.test.js`

Expected: FAIL because the screen does not exist and the route uses `GenericModule`.

- [ ] **Step 3: Implement the screen and dedicated route**

Build the page using the visual and accessibility patterns in `CompanySites.vue`: unframed heading, compact PrimeVue filters/table, 8px-or-less cards, icon action buttons with tooltips/ARIA labels, responsive dialog, semantic labels, `aria-describedby`, invalid state, busy state, and confirmation before status changes. Render role badges as `고객`, `공급업체`, or both. Format business numbers as `000-00-00000` for display only.

Add `'/master/partners': () => import('@/views/master/Partners.vue')` to `dedicatedViews`.

- [ ] **Step 4: Run mounted-view and router tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/master/Partners.vue src/views/master/partners.test.js src/router/index.js src/router/erp-router.test.js
git commit -m "feat: add partner master management screen"
```

### Task 6: Full Verification, Hosted Rollout, Documentation, And Push

**Files:**
- Modify: `docs/HANDOFF.md`
- Modify only if verification reveals a defect: relevant source or test files

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: verified hosted schema, deployed Cloudflare assets, current handoff record, and synchronized GitHub `main`.

- [ ] **Step 1: Run complete local verification**

Run: `npm test -- --run`

Run: `npx eslint src worker docs supabase --ext .vue,.js,.jsx,.cjs,.mjs --quiet`

Run: `npm run build`

Run: `git diff --check`

Run: `npm audit --omit=dev`

Run: `npx wrangler deploy --dry-run`

Expected: all commands exit 0. A Vite large-chunk warning is non-blocking; test, lint, build, audit, or dry-run failures are blocking.

- [ ] **Step 2: Review the exact hosted database change and obtain approval**

Show the user the migration filename, created table, three policies, two triggers, grants, constraints, and permission-key migration. Obtain explicit confirmation immediately before executing the hosted SQL.

- [ ] **Step 3: Apply and verify the Supabase migration**

Apply the exact contents of `supabase/migrations/20260914000200_add_partners.sql` to the current production project `mehhrnbaiojivesnobpv` (`nexerp`). The earlier reference `kctewzpeymlncibgyosz` is superseded and must not be used. Query `pg_class`, `pg_policies`, `information_schema.role_table_grants`, `pg_trigger`, `pg_constraint`, `pg_indexes`, and `role_menu_permissions` to verify the table, RLS, three policies, no delete grant, two triggers, required constraints/indexes, and absence of legacy permission keys.

- [ ] **Step 4: Deploy and smoke-test Cloudflare**

Run: `npm run deploy`

Run an HTTP GET against `https://nexerp.merciful-chips.workers.dev/api/health` and require status 200 with `services.supabase === 'configured'`. In a browser verify both legacy paths reach `/master/partners`, the PWA update completes, and no console-visible fatal error occurs. Full role/action verification requires an MFA-authenticated session and must be recorded as pending if the user has not completed enrollment.

- [ ] **Step 5: Update handoff documentation**

Record migration verification, test counts, Worker version, remaining MFA/manual checks, and pgTAP status in `docs/HANDOFF.md`. Do not mark a manual check complete without direct evidence.

- [ ] **Step 6: Commit, push, and compare remote HEAD**

```bash
git add docs/HANDOFF.md
git commit -m "docs: record partner master rollout"
git push origin main
git status --porcelain=v2 --branch
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: clean worktree, branch `+0 -0`, and identical local and remote hashes.
