# NEXERP Administrator Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver secure administrator account management, role-based menu permissions, a working administrator login, and canonical `nexerp` service naming.

**Architecture:** Supabase RLS and security-definer RPCs own role/menu authorization, while a Cloudflare Worker secret client is narrowly used for Auth user creation. Vue uses one stable menu-key model for both sidebar filtering and route guards, with dedicated PrimeVue administrator screens.

**Tech Stack:** Vue 3, Vue Router, PrimeVue 4, Supabase Auth/Postgres/RLS, Cloudflare Workers, Vitest, pgTAP

**Spec:** `docs/superpowers/specs/2026-09-12-admin-access-nexerp-design.md`

## Global Constraints

- The canonical service slug is exactly `nexerp`; the visible brand is `NEXERP`.
- `SUPABASE_SECRET_KEY` is server-only and must never enter `VITE_*`, source, Git, responses, or logs.
- Administrator management routes are fixed `admin` routes and cannot be disabled through dynamic menu permissions.
- Non-admin permission loading fails closed, and sidebar filtering and direct-route protection use the same stable menu key.
- Direct profile role/activation grants remain closed; protected RPCs own those mutations.
- HR and payroll remain excluded.

---

### Task 1: Supabase authorization model

**Files:**
- Create: `supabase/migrations/20260912000100_add_admin_access_control.sql`
- Create: `supabase/tests/admin_access_control_rls.test.sql`
- Modify: `supabase/tests/profiles_rls.test.sql`

**Interfaces:**
- Produces: `role_menu_permissions(role, allowed_menu_keys, revision, updated_at, updated_by)`.
- Produces: `admin_replace_role_menu_permissions(target_role, allowed_keys, expected_revision)` and `admin_update_profile(target_id, new_display_name, new_department, new_role, new_is_active)` RPCs.

- [ ] Add pgTAP failures for own-role reads, administrator reads, direct-write denial, non-admin RPC denial, revision conflicts, admin-role lock, self-demotion, and self-deactivation.
- [ ] Run `npx supabase test db` when the local stack is available and confirm the new assertions fail before the migration exists.
- [ ] Add the table, seed rows, grants, RLS policies, triggers, and both security-definer RPCs with empty `search_path` and fully qualified names.
- [ ] Re-run pgTAP when available; also run the repository Vitest contract that checks migration security clauses.
- [ ] Commit the SQL model and tests.

### Task 2: Worker administrator API

**Files:**
- Create: `worker/admin.js`
- Create: `worker/admin.test.js`
- Modify: `worker/app.js`
- Modify: `worker/app.test.js`
- Modify: `worker/supabase.js`
- Modify: `worker/auth.test.js`
- Modify: `.dev.vars.example`

**Interfaces:**
- Consumes: protected profile RPC from Task 1.
- Produces: `GET/POST /api/admin/accounts` and `PATCH /api/admin/accounts/:id`.
- Produces: `createAdminSupabaseClient(env)` using only `SUPABASE_SECRET_KEY`.

- [ ] Write failing tests for bearer validation, active-admin enforcement, payload validation, list/create/update success, duplicate email, compensation delete, missing secret, upstream failures, and response redaction.
- [ ] Run `npm test -- --run worker/admin.test.js worker/app.test.js worker/auth.test.js` and confirm the new cases fail.
- [ ] Implement validation, authorization, stable error mapping, admin-client construction, handlers, and routes without logging provider data.
- [ ] Re-run the targeted Worker tests and confirm they pass.
- [ ] Commit the Worker API and example configuration.

### Task 3: Stable menu permissions and route enforcement

**Files:**
- Modify: `src/data/erp.js`
- Modify: `src/data/erp.test.js`
- Create: `src/repositories/access/supabaseAccessRepository.js`
- Create: `src/repositories/access/supabaseAccessRepository.test.js`
- Create: `src/stores/access.js`
- Create: `src/stores/access.test.js`
- Modify: `src/router/index.js`
- Modify: `src/router/authGuard.js`
- Modify: `src/router/authGuard.test.js`
- Modify: `src/router/erp-router.test.js`
- Modify: `src/layout/AppMenu.vue`
- Modify: `src/layout/erp-shell.test.js`

**Interfaces:**
- Consumes: `role_menu_permissions` from Task 1.
- Produces: unique `menuKey` on every leaf, `filterMenuByAccess(items, canAccess)`, and access-store `ensureLoaded(role)`, `canAccess(menuKey, role)`, `loadAll()`, `save(role, keys, revision)`.

- [ ] Write failing tests for unique keys, recursive filtering, empty-parent removal, own-role loading, fail-closed errors, admin bootstrap access, direct-route denial, and sidebar hiding.
- [ ] Run the targeted data/store/router/layout tests and confirm the new assertions fail.
- [ ] Implement the menu keys, repository, singleton access store, router meta/guard integration, and computed sidebar model.
- [ ] Re-run the targeted tests and confirm they pass.
- [ ] Commit menu permission enforcement.

### Task 4: Administrator screens

**Files:**
- Create: `src/services/adminApi.js`
- Create: `src/services/adminApi.test.js`
- Create: `src/views/admin/AccountManagement.vue`
- Create: `src/views/admin/MenuPermissionManagement.vue`
- Create: `src/views/admin/admin-views.test.js`
- Modify: `src/router/index.js`
- Modify: `src/data/erp.js`
- Modify: `src/layout/AppTopbar.vue`
- Modify: `src/layout/erp-shell.test.js`

**Interfaces:**
- Consumes: Worker administrator API and access store from earlier tasks.
- Produces: dedicated administrator account and menu-permission pages at `/settings/accounts` and `/settings/menu-permissions`.

- [ ] Write failing service and view tests for account loading, create validation, temporary-password handling, editing, self-lock controls, role selection, grouped permission toggles, dirty/reset/save, conflict recovery, and normalized errors.
- [ ] Run the targeted service/view/router/layout tests and confirm the new assertions fail.
- [ ] Implement the API service and both responsive PrimeVue screens with Toast/ConfirmDialog feedback and accessible labels.
- [ ] Update system and topbar navigation to the two fixed administrator routes.
- [ ] Re-run targeted tests and confirm they pass.
- [ ] Commit the administrator interface.

### Task 5: Canonical naming, integration, and production rollout

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/setup/cloudflare-supabase.md`
- Modify: `docs/setup/fresh-machine.md`
- Test: all project tests and production build

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: canonical `nexerp` package, Worker, Supabase display name, and GitHub repository plus a deployed administrator account.

- [ ] Add naming and documentation assertions that fail while legacy deployment identifiers remain.
- [ ] Rename source-controlled identifiers to `nexerp` and update operational documentation.
- [ ] Run `npm test -- --run` and `npm run build`; confirm all tests and the production build pass.
- [ ] Apply the migration in Supabase SQL Editor and verify table, RLS, RPC, policies, and seed rows.
- [ ] Create `nexadmin01@gmail.com` in Supabase Auth with an email-confirmed temporary password, promote the generated profile, and verify an authenticated admin identity.
- [ ] Store `SUPABASE_SECRET_KEY` only as a Cloudflare Worker secret and deploy `nexerp`.
- [ ] Verify production health, anonymous API rejection, administrator login, both administrator screens, console logs, and responsive overflow.
- [ ] Rename the Supabase display project and GitHub repository to `nexerp`, update `origin`, push the branch, and retire the verified legacy Worker.
- [ ] Commit final documentation and deployment metadata.
