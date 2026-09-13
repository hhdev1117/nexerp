# Mandatory Google Authenticator And Gmail Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require TOTP AAL2 for every active ERP account and restrict new account provisioning to Gmail addresses.

**Architecture:** Extend the existing auth store with an in-memory MFA state machine and place a mandatory MFA gate in the router before ERP routes. Enforce the same AAL2 policy in Worker authorization and PostgreSQL, while keeping self-profile lookup available at AAL1 for onboarding.

**Tech Stack:** Vue 3, Vue Router, PrimeVue, Supabase Auth MFA, Cloudflare Workers, PostgreSQL, Vitest

**Spec:** `docs/superpowers/specs/2026-09-13-mandatory-totp-gmail-design.md`

## Global Constraints

- Every active account must reach Supabase AAL2 before entering ERP routes.
- New accounts must use an address ending with exactly `@gmail.com` after lowercase normalization.
- Google OAuth is excluded; authentication remains password plus TOTP.
- Never log or persist QR data, TOTP secrets, `otpauth` URIs, codes, challenge IDs, JWTs, or raw provider errors.
- Existing non-Gmail accounts remain usable and must enroll TOTP.
- Administrator Worker APIs and security-definer administrator RPCs require AAL2.
- A user may not remove the last verified TOTP factor.

---

### Task 1: MFA Auth State Machine

**Files:**
- Modify: `src/stores/auth.js`
- Modify: `src/stores/auth.test.js`

**Interfaces:**
- Consumes: Supabase `auth.mfa.listFactors`, `getAuthenticatorAssuranceLevel`, `enroll`, `challenge`, `verify`, `unenroll`, and `auth.refreshSession`.
- Produces: refs `mfaStatus`, `mfaFactors`, `mfaEnrollment`; computed `mfaSatisfied`; methods `refreshMfaState`, `beginTotpEnrollment`, `verifyTotpEnrollment`, `verifyTotpChallenge`, `cancelTotpEnrollment`, `unenrollTotp`.

- [ ] **Step 1: Add failing state-machine tests**

Cover no factor to `enroll`, verified factor to `challenge`, AAL2 to `ready`,
lookup failure to fail-closed `error`, enrollment data remaining in memory only,
fresh challenge per verification attempt, session replacement after verify,
current-identity unverified-factor cleanup, stale-identity response discard,
cancellation cleanup, and refusal to remove the last verified factor.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run src/stores/auth.test.js`

Expected: FAIL because MFA state and methods do not exist.

- [ ] **Step 3: Implement the state machine**

Use stable Korean validation/errors, six numeric digits, identity-version checks
for asynchronous results, and `clearMfaState()` from every identity-clearing path.
Consume the session returned by `verify`, then recompute factors/AAL. After
unenroll, call `refreshSession()` before recomputing AAL. Never try to clean an old
identity's stale factor with the replacement identity's session; discard its
enrollment material and rely on Supabase's short unverified-factor expiry.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/stores/auth.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/auth.js src/stores/auth.test.js
git commit -m "feat: add mandatory TOTP auth state"
```

### Task 2: Mandatory MFA Routes And Screens

**Files:**
- Create: `src/views/auth/MfaView.vue`
- Create: `src/views/admin/SecuritySettings.vue`
- Modify: `src/views/auth/LoginView.vue`
- Modify: `src/layout/AppTopbar.vue`
- Modify: `src/router/authGuard.js`
- Modify: `src/router/index.js`
- Modify: `src/views/auth/auth-views.test.js`
- Modify: `src/layout/erp-shell.test.js`
- Modify: `src/router/authGuard.test.js`
- Modify: `src/router/erp-router.test.js`
- Modify: `src/views/admin/admin-views.test.js`

**Interfaces:**
- Consumes: Task 1 MFA refs and methods.
- Produces: `/auth/mfa`, `/settings/security`, mandatory AAL2 navigation, profile-menu security command, accessible enrollment/challenge/factor-management screens.

- [ ] **Step 1: Write failing route and UI tests**

Cover safe redirect preservation, AAL1 enrollment/challenge redirects, AAL2
admission, MFA route-loop prevention, QR rendering, hidden-by-default manual key,
six-digit validation, sign-out, retry, backup enrollment, factor list, and
last-factor removal protection.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run src/router/authGuard.test.js src/router/erp-router.test.js src/views/auth/auth-views.test.js src/views/admin/admin-views.test.js src/layout/erp-shell.test.js`

Expected: FAIL because routes and views do not exist.

- [ ] **Step 3: Implement routes and screens**

Use a single local-redirect validator, PrimeVue controls, semantic headings,
`autocomplete="one-time-code"`, `inputmode="numeric"`, explicit loading states,
and icon buttons with accessible labels. Do not put secret material into query
parameters, storage, toast messages, or error objects.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/auth/MfaView.vue src/views/admin/SecuritySettings.vue src/views/auth/LoginView.vue src/layout/AppTopbar.vue src/router/authGuard.js src/router/index.js src/views/auth/auth-views.test.js src/layout/erp-shell.test.js src/router/authGuard.test.js src/router/erp-router.test.js src/views/admin/admin-views.test.js
git commit -m "feat: require Google Authenticator login"
```

### Task 3: Gmail Provisioning And Administrator MFA Enforcement

**Files:**
- Modify: `worker/admin.js`
- Modify: `worker/admin.test.js`
- Modify: `worker/app.js`
- Modify: `worker/app.test.js`
- Modify: `worker/infrastructure.test.js`
- Modify: `src/services/adminApi.js`
- Modify: `src/services/adminApi.test.js`
- Modify: `src/views/admin/AccountManagement.vue`
- Modify: `src/views/admin/adminModels.js`
- Modify: `src/views/admin/admin-views.test.js`

**Interfaces:**
- Consumes: bearer JWT and Supabase user/admin clients.
- Produces: `gmail_required` and `mfa_required` API errors, Gmail-only create requests, `POST /api/admin/accounts/:id/mfa-reset`, and administrator account-factor reset UI.

- [ ] **Step 1: Write failing Worker, service, and UI tests**

Cover case-insensitive Gmail normalization, rejection of subdomains and trailing
text, AAL1 rejection before administrator data access, AAL2 success, lookup
failure redaction, provisioned app metadata, target-factor deletion, self-reset
rejection, partial provider failure handling, and confirmation UI.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run worker/admin.test.js worker/app.test.js worker/infrastructure.test.js src/services/adminApi.test.js src/views/admin/admin-views.test.js`

Expected: FAIL for missing Gmail/AAL/reset behavior.

- [ ] **Step 3: Implement Worker and UI enforcement**

Call `getAuthenticatorAssuranceLevel(token)` in administrator authorization and
require `currentLevel === 'aal2'`. Add `app_metadata: { nexerp_provisioned: true }`
when creating users. Implement factor reset through
`auth.admin.mfa.listFactors({ userId })` and `deleteFactor({ id, userId })`, reject
self-reset, and never return factor IDs or provider errors.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/admin.js worker/admin.test.js worker/app.js worker/app.test.js worker/infrastructure.test.js src/services/adminApi.js src/services/adminApi.test.js src/views/admin/AccountManagement.vue src/views/admin/adminModels.js src/views/admin/admin-views.test.js
git commit -m "feat: enforce MFA and Gmail account provisioning"
```

### Task 4: Database And Supabase Enforcement

**Files:**
- Create: `supabase/migrations/20260913000300_enforce_totp_and_gmail_provisioning.sql`
- Create: `supabase/migrations/mandatory_totp_gmail.test.js`
- Modify: `supabase/config.toml`
- Modify: `supabase/tests/profiles_rls.test.sql`
- Modify: `supabase/tests/admin_access_control_rls.test.sql`

**Interfaces:**
- Consumes: Supabase JWT `aal` claim, `auth.users.raw_app_meta_data`, existing `private.is_admin()` and administrator RPCs.
- Produces: `private.is_aal2()`, AAL2-aware administrator authorization, AAL2 role-menu policies, and a guarded new-user trigger.

- [ ] **Step 1: Write failing migration contract tests**

Assert exact Gmail suffix validation, `nexerp_provisioned` app-metadata guard,
empty search paths, ownership/grants, AAL2 dependency in `private.is_admin`, AAL2
role-menu access, explicit local TOTP enablement, and disabled public signup.

- [ ] **Step 2: Run migration tests and confirm RED**

Run: `npm test -- --run supabase/migrations/mandatory_totp_gmail.test.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the migration and local configuration**

Create `private.is_aal2()` as stable security-definer SQL with empty search path.
Replace `private.is_admin()` to require it, replace the role-menu read policies
with AAL2 conditions, and replace `private.handle_new_user()` so only exact Gmail
emails carrying a true `nexerp_provisioned` marker create profiles. Set local
`auth.mfa.totp` enrollment and verification to true.
Set local `auth.enable_signup` to false so only the administrator provisioning path
creates accounts.

- [ ] **Step 4: Run migration and full tests**

Run: `npm test -- --run supabase/migrations/mandatory_totp_gmail.test.js`

Run: `npm test -- --run`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260913000300_enforce_totp_and_gmail_provisioning.sql supabase/migrations/mandatory_totp_gmail.test.js supabase/config.toml supabase/tests/profiles_rls.test.sql supabase/tests/admin_access_control_rls.test.sql docs/superpowers/specs/2026-09-13-mandatory-totp-gmail-design.md docs/superpowers/plans/2026-09-13-mandatory-totp-gmail.md
git commit -m "feat: enforce TOTP and Gmail accounts in Supabase"
```

### Task 5: Production Rollout

**Files:**
- Modify only if verification reveals a defect.

**Interfaces:**
- Consumes: Tasks 1-4 production build and SQL migration.
- Produces: deployed Worker/assets, applied migration, enrolled administrator, and synchronized GitHub `main`.

- [ ] **Step 1: Run final static verification**

Run: `npm test -- --run`

Run: `npm run build`

Run: `npx wrangler deploy --dry-run`

Expected: tests and build PASS; Worker assets are recognized.

- [ ] **Step 2: Deploy the MFA-capable application**

Run: `npm run deploy`

Expected: the MFA route and Gmail-aware Worker are live before database enforcement
changes the authorization and provisioning contracts.

- [ ] **Step 3: Apply the Supabase migration**

Run the exact SQL from
`supabase/migrations/20260913000300_enforce_totp_and_gmail_provisioning.sql` in the
connected project, then query catalog definitions and privileges to verify the
functions and policies. In the hosted Auth settings, disable public/email signup
and confirm TOTP enrollment and verification are enabled; local `config.toml`
does not change these hosted controls.

- [ ] **Step 4: Complete browser verification**

Verify Gmail rejection in account creation, mandatory administrator enrollment,
QR registration in Google Authenticator, AAL2 ERP access, a fresh-login OTP
challenge, dashboard/sidebar scrolling, and factor-management protections. Never
record the TOTP secret or six-digit codes in reports.

- [ ] **Step 5: Push and verify GitHub**

```bash
git push origin main
git ls-remote origin refs/heads/main
```

Expected: remote `main` equals local `HEAD`.
