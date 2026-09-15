# Login ID Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-facing email authentication with lowercase alphanumeric login IDs for every NEXERP account, then create the first administrator safely.

**Architecture:** Supabase Auth remains the password, session, and TOTP provider. A shared identity module validates `loginId` and deterministically maps it to an internal `<loginId>@nexerp.internal` address; database profiles and every public API expose `loginId`, while the internal address remains an implementation detail.

**Tech Stack:** Vue 3, PrimeVue, Supabase JS 2, Cloudflare Workers, PostgreSQL migrations, Vitest, ESLint, Vite.

**Spec:** `docs/superpowers/specs/2026-09-14-login-id-auth-design.md`

## Global Constraints

- Login IDs must match `^[a-z0-9]{4,20}$` exactly.
- Numeric-first IDs are allowed; uppercase, Korean, whitespace, and special characters are rejected.
- Internal addresses use `<loginId>@nexerp.internal` and must never appear in application UI or public Worker responses.
- Supabase continues to own passwords, sessions, refresh tokens, and TOTP factors.
- Public signup remains disabled; account creation remains administrator-only.
- Existing AAL2, active-user, RLS, and self-protection rules remain in force.
- The first administrator bootstrap must refuse to run when an active administrator already exists.

---

### Task 1: Shared login identity rules

**Files:**
- Create: `src/lib/auth/loginIdentity.js`
- Create: `src/lib/auth/loginIdentity.test.js`
- Create: `worker/loginIdentity.js`
- Create: `worker/loginIdentity.test.js`

**Interfaces:**
- Produces: `LOGIN_ID_PATTERN`, `isValidLoginId(value)`, and `loginIdToInternalEmail(loginId)` in browser and Worker modules.
- Contract: valid IDs return `<id>@nexerp.internal`; invalid input returns `null` and is never normalized.

- [ ] **Step 1: Write failing browser and Worker identity tests**

```js
import { describe, expect, it } from 'vitest';
import { isValidLoginId, loginIdToInternalEmail } from './loginIdentity';

describe('login identity', () => {
    it.each(['admin01', '1234', 'a1b2'])('accepts %s', (value) => expect(isValidLoginId(value)).toBe(true));
    it.each(['abc', 'Admin01', 'admin_01', '관리자1', 'admin 01', 'a'.repeat(21)])('rejects %s', (value) => expect(isValidLoginId(value)).toBe(false));
    it('maps a valid ID to the internal auth address', () => expect(loginIdToInternalEmail('admin01')).toBe('admin01@nexerp.internal'));
    it('does not normalize invalid input', () => expect(loginIdToInternalEmail('Admin01')).toBeNull());
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/lib/auth/loginIdentity.test.js worker/loginIdentity.test.js`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement the minimal shared contract in both runtime modules**

```js
export const LOGIN_ID_PATTERN = /^[a-z0-9]{4,20}$/;
export const isValidLoginId = (value) => typeof value === 'string' && LOGIN_ID_PATTERN.test(value);
export const loginIdToInternalEmail = (value) => (isValidLoginId(value) ? `${value}@nexerp.internal` : null);
```

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/lib/auth/loginIdentity.test.js worker/loginIdentity.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/loginIdentity.js src/lib/auth/loginIdentity.test.js worker/loginIdentity.js worker/loginIdentity.test.js
git commit -m "feat: add login ID identity rules"
```

### Task 2: Database login ID migration

**Files:**
- Create: `supabase/migrations/20260915000100_add_login_ids.sql`
- Create: `supabase/migrations/login_ids.test.js`
- Create: `supabase/tests/login_ids_rls.test.sql`

**Interfaces:**
- Produces: `profiles.login_id text not null`, `profiles_login_id_key`, `profiles_login_id_format`, and a revised `private.handle_new_user()` trigger.
- Consumes: `auth.users.raw_app_meta_data.login_id` and the internal email contract from Task 1.

- [ ] **Step 1: Write failing migration structure tests**

```js
expect(sql).toContain("add column login_id text");
expect(sql).toContain("login_id ~ '^[a-z0-9]{4,20}$'");
expect(sql).toContain('create unique index profiles_login_id_key');
expect(sql).toContain("new.raw_app_meta_data ->> 'login_id'");
expect(sql).toContain("normalized_login_id || '@nexerp.internal'");
```

- [ ] **Step 2: Run the migration test and verify failure**

Run: `npx vitest run supabase/migrations/login_ids.test.js`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Write an atomic migration**

```sql
begin;

alter table public.profiles add column login_id text;
alter table public.profiles add constraint profiles_login_id_format check (login_id ~ '^[a-z0-9]{4,20}$');
create unique index profiles_login_id_key on public.profiles (login_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_login_id text := coalesce(new.raw_app_meta_data ->> 'login_id', '');
    expected_email text := normalized_login_id || '@nexerp.internal';
begin
    if normalized_login_id !~ '^[a-z0-9]{4,20}$' then
        raise exception using errcode = '22023', message = 'invalid_login_id';
    end if;
    if pg_catalog.lower(coalesce(new.email, '')) <> expected_email then
        raise exception using errcode = '22023', message = 'login_identity_mismatch';
    end if;
    if not coalesce(new.raw_app_meta_data @> '{"nexerp_provisioned": true}'::jsonb, false) then
        raise exception using errcode = '42501', message = 'provisioning_required';
    end if;
    insert into public.profiles (id, email, login_id, role)
    values (new.id, expected_email, normalized_login_id, 'user'::public.app_role);
    return new;
end;
$$;

alter table public.profiles alter column login_id set not null;
commit;
```

- [ ] **Step 4: Add SQL assertions for uniqueness, invalid IDs, mismatched internal addresses, and valid provisioning**

Use transactions that roll back test users and assert SQLSTATE `22023`, `42501`, and `23505` without weakening existing RLS.

- [ ] **Step 5: Run database migration tests**

Run: `npx vitest run supabase/migrations/login_ids.test.js supabase/migrations/mandatory_totp_gmail.test.js`

Expected: new test PASS; update the old Gmail policy test to assert replacement by the login identity policy.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915000100_add_login_ids.sql supabase/migrations/login_ids.test.js supabase/migrations/mandatory_totp_gmail.test.js supabase/tests/login_ids_rls.test.sql
git commit -m "feat: store login IDs in profiles"
```

### Task 3: Worker account API conversion

**Files:**
- Modify: `worker/admin.js`
- Modify: `worker/admin.test.js`
- Modify: `worker/app.test.js`
- Modify: `src/services/adminApi.js`
- Modify: `src/services/adminApi.test.js`

**Interfaces:**
- Consumes: `loginIdToInternalEmail(loginId)` from `worker/loginIdentity.js`.
- Produces: public account shape `{ id, loginId, displayName, department, role, isActive, createdAt, updatedAt }` and POST body `{ loginId, temporaryPassword, displayName, department, role }`.

- [ ] **Step 1: Change tests to require login IDs and forbid leaked emails**

```js
expect(createUser).toHaveBeenCalledWith({
    email: 'staff01@nexerp.internal',
    password: 'temporary-password',
    email_confirm: true,
    app_metadata: { nexerp_provisioned: true, login_id: 'staff01' }
});
expect(payload.account).toMatchObject({ loginId: 'staff01' });
expect(payload.account).not.toHaveProperty('email');
```

Add cases for invalid IDs, duplicate Auth users mapped to `login_id_exists`, compensation deletion, list responses, password reset, and MFA reset.

- [ ] **Step 2: Run Worker/API tests and verify failure**

Run: `npx vitest run worker/admin.test.js worker/app.test.js src/services/adminApi.test.js`

Expected: FAIL because production code still accepts and exposes email.

- [ ] **Step 3: Update Worker validation and public serialization**

```js
import { loginIdToInternalEmail } from './loginIdentity';

const accountColumns = 'id, login_id, display_name, department, role, is_active, created_at, updated_at';

function publicAccount(profile) {
    return {
        id: profile.id,
        loginId: profile.login_id,
        displayName: profile.display_name,
        department: profile.department,
        role: profile.role,
        isActive: profile.is_active,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
    };
}
```

Validate `body.loginId`, derive `email`, pass both provisioning metadata keys, and map `email_exists`/`user_already_exists` to `login_id_exists`.

- [ ] **Step 4: Update client API error mapping**

Map `invalid_login_id` and `login_id_exists`; send `loginId` without email.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run worker/admin.test.js worker/app.test.js src/services/adminApi.test.js`

Expected: PASS with no public `email` field.

- [ ] **Step 6: Commit**

```bash
git add worker/admin.js worker/admin.test.js worker/app.test.js src/services/adminApi.js src/services/adminApi.test.js
git commit -m "feat: manage accounts by login ID"
```

### Task 4: Client authentication and profile identity

**Files:**
- Modify: `src/stores/auth.js`
- Modify: `src/stores/auth.test.js`
- Modify: `worker/app.js`
- Modify: `worker/app.test.js`

**Interfaces:**
- Consumes: `loginIdToInternalEmail(loginId)` from `src/lib/auth/loginIdentity.js`.
- Produces: `authStore.signIn(loginId, password)` and profile fields containing `login_id`.

- [ ] **Step 1: Write failing sign-in, identity, and reauthentication tests**

```js
await store.signIn('admin01', 'password123');
expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'admin01@nexerp.internal',
    password: 'password123'
});
expect(store.profile.value.login_id).toBe('admin01');
```

Assert invalid IDs never call Supabase, auth failures use one generic message, password changes still reauthenticate with the internal session email, and Worker session responses expose `loginId` but not email.

- [ ] **Step 2: Run auth tests and verify failure**

Run: `npx vitest run src/stores/auth.test.js worker/app.test.js`

Expected: FAIL on the email-based API contract.

- [ ] **Step 3: Implement login ID authentication**

```js
const signIn = async (loginId, password) => {
    const email = loginIdToInternalEmail(loginId);
    if (!email) throw rejection('아이디 또는 비밀번호가 올바르지 않습니다.');
    const response = await client.auth.signInWithPassword({ email, password });
    // Preserve existing session tracking and AAL handling.
};
```

Add `login_id` to profile selects, require it during identity validation, and serialize `loginId` rather than `user.email` from the Worker.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/stores/auth.test.js worker/app.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/auth.js src/stores/auth.test.js worker/app.js worker/app.test.js
git commit -m "feat: authenticate with login IDs"
```

### Task 5: Login and account management UI

**Files:**
- Modify: `src/views/auth/LoginView.vue`
- Modify: `src/views/auth/auth-views.test.js`
- Modify: `src/views/admin/adminModels.js`
- Modify: `src/views/admin/AccountManagement.vue`
- Modify: `src/views/admin/admin-views.test.js`
- Modify: `src/layout/AppTopbar.vue`
- Modify: `src/layout/AppTopbar.test.js`

**Interfaces:**
- Consumes: account `loginId` fields and `authStore.signIn(loginId, password)`.
- Produces: email-free login, account creation, list, search, and profile fallback UI.

- [ ] **Step 1: Write failing UI/model tests**

Assert login input uses `id="login-id"`, `autocomplete="username"`, and text input; validation rejects `Admin01` and accepts `admin01`; account creation emits `loginId`; tables and search use `loginId`; rendered output contains no internal email domain.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `npx vitest run src/views/auth/auth-views.test.js src/views/admin/admin-views.test.js src/layout/AppTopbar.test.js`

Expected: FAIL on email labels and fields.

- [ ] **Step 3: Update login form**

```js
const loginId = ref('');
if (!loginId.value) errors.loginId = '아이디를 입력해 주세요.';
else if (!isValidLoginId(loginId.value)) errors.loginId = '아이디는 영문 소문자와 숫자 4~20자로 입력해 주세요.';
await authStore.signIn(loginId.value, password.value);
```

Use label `아이디`, `type="text"`, `inputmode="text"`, `autocomplete="username"`, and preserve current focus/error-summary accessibility.

- [ ] **Step 4: Update account management and topbar**

Replace Gmail fields, validators, payloads, table subtitles, search targets, duplicate errors, and fallback display with `loginId`. Keep 44px touch targets and existing responsive layout.

- [ ] **Step 5: Run focused tests and lint**

Run: `npx vitest run src/views/auth/auth-views.test.js src/views/admin/admin-views.test.js src/layout/AppTopbar.test.js`

Run: `npx eslint src/views/auth/LoginView.vue src/views/admin/AccountManagement.vue src/views/admin/adminModels.js src/layout/AppTopbar.vue`

Expected: PASS with no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/auth/LoginView.vue src/views/auth/auth-views.test.js src/views/admin/adminModels.js src/views/admin/AccountManagement.vue src/views/admin/admin-views.test.js src/layout/AppTopbar.vue src/layout/AppTopbar.test.js
git commit -m "feat: replace email UI with login IDs"
```

### Task 6: First administrator bootstrap

**Files:**
- Create: `scripts/bootstrap-admin.mjs`
- Create: `scripts/bootstrap-admin.test.js`
- Modify: `package.json`
- Modify: `docs/setup/cloudflare-supabase.md`
- Modify: `README.md`

**Interfaces:**
- Consumes environment variables `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXERP_ADMIN_LOGIN_ID`, and `NEXERP_ADMIN_TEMPORARY_PASSWORD`.
- Produces: `npm run bootstrap:admin`; no credential output.

- [ ] **Step 1: Write failing bootstrap tests**

Mock the Supabase client and assert the script rejects invalid IDs, refuses when an active admin exists, creates `admin01@nexerp.internal` with `login_id` metadata, promotes the resulting profile, compensates a failed promotion by deleting the Auth user, and never logs the password.

- [ ] **Step 2: Run bootstrap tests and verify failure**

Run: `npx vitest run scripts/bootstrap-admin.test.js`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement a testable bootstrap module**

```js
export async function bootstrapAdmin({ loginId, temporaryPassword, client, logger = console }) {
    const email = loginIdToInternalEmail(loginId);
    if (!email) throw new Error('invalid_login_id');
    const existing = await client.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1);
    if (existing.data?.length) throw new Error('active_admin_exists');
    const created = await client.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        app_metadata: { nexerp_provisioned: true, login_id: loginId }
    });
    // Promote by protected server-side update; delete the created Auth user if promotion fails.
    logger.info(`Administrator ${loginId} created.`);
}
```

The CLI entry point reads environment variables, validates an 8–128 character temporary password, and exits nonzero with stable error codes.

- [ ] **Step 4: Add package script and operator documentation**

```json
"bootstrap:admin": "node scripts/bootstrap-admin.mjs"
```

Document PowerShell environment variable setup without literal credentials, execution, immediate cleanup of `NEXERP_ADMIN_TEMPORARY_PASSWORD`, first login, and mandatory TOTP enrollment.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run scripts/bootstrap-admin.test.js docs/setup/setup-docs.test.js`

Expected: PASS and no credential values in fixtures or docs.

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap-admin.mjs scripts/bootstrap-admin.test.js package.json README.md docs/setup/cloudflare-supabase.md docs/setup/setup-docs.test.js
git commit -m "feat: add first administrator bootstrap"
```

### Task 7: Deploy, create administrator, and verify responsive flows

**Files:**
- Modify only if verification finds defects: files owned by Tasks 1–6.
- Runtime changes: new Supabase migration, Auth administrator, Cloudflare Worker deployment.

**Interfaces:**
- Consumes all earlier task outputs.
- Produces a working administrator login on `https://nexerp.nexerp.workers.dev`.

- [ ] **Step 1: Run the complete local verification suite**

Run: `npx vitest run --exclude ".worktrees/**"`

Run: `npx eslint src worker scripts --ext .vue,.js,.mjs`

Run: `npm run build`

Expected: all tests pass, lint exits 0, production build succeeds.

- [ ] **Step 2: Apply the new SQL migration to project `mehhrnbaiojivesnobpv`**

Use Supabase SQL Editor or `npx supabase db push` with the project database password. Verify `profiles.login_id`, the format constraint, unique index, and revised trigger through a service-role REST request.

- [ ] **Step 3: Obtain the administrator ID and temporary password at execution time**

The operator supplies an ID matching `^[a-z0-9]{4,20}$` and a temporary password of 8–128 characters. Do not place either in source control; do not echo the password.

- [ ] **Step 4: Bootstrap the first administrator**

Run `npm run bootstrap:admin` with temporary environment variables. Clear the password variable immediately afterward and verify the profile is active with role `admin` without returning the internal email.

- [ ] **Step 5: Deploy the Worker with existing encrypted secrets**

Run: `npm run deploy`

Expected: deployment succeeds to `https://nexerp.nexerp.workers.dev`.

- [ ] **Step 6: Verify desktop and mobile behavior**

At desktop width and at 390px width, confirm ID validation, password input, TOTP enrollment, successful administrator navigation, account creation form, account search, and infrastructure usage. Confirm no page displays `@nexerp.internal`.

- [ ] **Step 7: Route verification defects back to their owning task**

If verification fails, return to the Task 1–6 test cycle that owns the affected file, add a regression test, implement the minimal correction, rerun that task's focused checks, and commit the same explicit file set listed in that task.
