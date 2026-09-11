# Cloudflare and Supabase ERP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Sakai Vue ERP into its canonical repository and add a deployable Cloudflare Worker plus Supabase authentication, roles, RLS, and future persistence boundaries.

**Architecture:** One Cloudflare Worker deploys the Vite SPA through Workers Static Assets and handles `/api/*` before assets. The Vue client uses a Supabase publishable key for sessions, while authenticated Worker requests validate the bearer token and execute with user context so Postgres RLS remains authoritative. Existing ERP demo records stay in memory behind a repository contract until individual modules receive database schemas.

**Tech Stack:** Vue 3, Vue Router 4, Vite 5, PrimeVue 4, Vitest 3, Supabase JavaScript 2, PostgreSQL RLS, Cloudflare Workers Static Assets, Wrangler 4

**Spec:** `docs/superpowers/specs/2026-09-11-cloudflare-supabase-foundation-design.md`

## Global Constraints

- The application is for one company; do not add `organization_id` or tenant switching.
- Roles are exactly `admin`, `approver`, and `user`.
- Authentication uses email and password through Supabase Auth.
- The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Secret or service-role credentials never enter Vite variables, committed files, logs, or client responses.
- Every exposed Supabase table has explicit grants and Row Level Security.
- Preserve the existing Sakai Vue and PrimeVue UI, ERP routes, demo behavior, accessibility, and tests.
- R2 export, retention, purge, restore, and encryption policy remain outside this implementation.
- `https://github.com/hhdev1117/nxe-erd.git` is canonical; every completed task is pushed to `origin/main` after verification.

---

### Task 1: Migrate and Verify the ERP Baseline

**Files:**
- Copy: existing ERP working tree into repository root
- Preserve: `docs/superpowers/specs/2026-09-11-cloudflare-supabase-foundation-design.md`
- Preserve: `docs/superpowers/plans/2026-09-11-cloudflare-supabase-foundation.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: source working tree at `D:\Users\vmfort\Documents\Codex\2026-09-11\clone-ui-d-users-vmfort-codex`
- Produces: verified Sakai ERP baseline in `D:\Users\vmfort\Desktop\ERP` with the destination `.git` history intact

- [ ] **Step 1: Copy the project content without generated or repository metadata**

```powershell
$source = 'D:\Users\vmfort\Documents\Codex\2026-09-11\clone-ui-d-users-vmfort-codex'
$excluded = @('.git', 'node_modules', 'dist', '.clone-ui', 'docs')
Get-ChildItem -LiteralPath $source -Force |
    Where-Object { $_.Name -notin $excluded } |
    Copy-Item -Destination . -Recurse -Force
```

- [ ] **Step 2: Extend `.gitignore` for Cloudflare and Supabase local secrets**

```gitignore
.dev.vars
.wrangler/
.supabase/
supabase/.branches/
supabase/.temp/
```

- [ ] **Step 3: Install the existing dependencies**

Run: `npm install`

Expected: installation completes and `npm ls --depth=0` exits with code 0.

- [ ] **Step 4: Run the inherited verification suite**

Run: `npm test -- --run && npm run build && npx eslint src --quiet`

Expected: 12 test files and 32 tests pass; the Vite build succeeds; ESLint reports no errors.

- [ ] **Step 5: Commit and push the baseline**

```powershell
git add .
git commit -m "feat: migrate Sakai ERP baseline"
git push origin main
```

Expected: `git status --short` is empty and `origin/main` points at the new commit.

### Task 2: Add the Cloudflare Worker Runtime

**Files:**
- Create: `worker/http.js`
- Create: `worker/app.js`
- Create: `worker/index.js`
- Create: `worker/app.test.js`
- Create: `wrangler.jsonc`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Env` with `ASSETS.fetch(request)`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`
- Produces: `createWorkerApp(dependencies): { fetch(request, env): Promise<Response> }`, `jsonResponse(body, init)`, and `/api/health`

- [ ] **Step 1: Write failing Worker routing tests**

```js
import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';

describe('Cloudflare Worker app', () => {
    it('reports configured health without exposing values', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/health'), {
            SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example'
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, services: { supabase: 'configured' } });
    });

    it('uses the assets binding outside the API namespace', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('app'));
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/sales/orders'), { ASSETS: { fetch } });
        expect(await response.text()).toBe('app');
        expect(fetch).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run the Worker tests to verify they fail**

Run: `npx vitest run worker/app.test.js`

Expected: FAIL because `worker/app.js` does not exist.

- [ ] **Step 3: Implement stable JSON responses and route dispatch**

```js
// worker/http.js
export const jsonResponse = (body, init = {}) =>
    Response.json(body, {
        ...init,
        headers: { 'cache-control': 'no-store', ...init.headers }
    });

// worker/app.js
import { jsonResponse } from './http';

export function createWorkerApp(dependencies = {}) {
    return {
        async fetch(request, env) {
            const { pathname } = new URL(request.url);
            if (pathname === '/api/health' && request.method === 'GET') {
                const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
                return jsonResponse(
                    { ok: configured, services: { supabase: configured ? 'configured' : 'missing_configuration' } },
                    { status: configured ? 200 : 503 }
                );
            }
            if (pathname.startsWith('/api/')) {
                return jsonResponse({ error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' } }, { status: 404 });
            }
            return env.ASSETS.fetch(request);
        }
    };
}
```

`worker/index.js` exports `createWorkerApp().fetch` as the module Worker handler.

- [ ] **Step 4: Configure Workers Static Assets and scripts**

```jsonc
{
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "nxe-erp",
    "main": "./worker/index.js",
    "compatibility_date": "2026-09-11",
    "assets": {
        "directory": "./dist",
        "binding": "ASSETS",
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*"]
    }
}
```

Add `wrangler` as a development dependency and scripts `dev:cloudflare`, `deploy`, and `cf:typegen`. `dev:cloudflare` builds the SPA and runs `wrangler dev`; `deploy` runs the production build before `wrangler deploy`.

- [ ] **Step 5: Run Worker and project verification**

Run: `npx vitest run worker/app.test.js && npm run build && npx wrangler deploy --dry-run`

Expected: Worker tests pass, assets build, and Wrangler validates and bundles without deployment.

- [ ] **Step 6: Commit and push the Cloudflare runtime**

```powershell
git add package.json package-lock.json wrangler.jsonc worker
git commit -m "feat: add Cloudflare Worker runtime"
git push origin main
```

### Task 3: Add Supabase Schema and Client Configuration

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260911000100_create_profiles.sql`
- Create: `supabase/tests/profiles_rls.test.sql`
- Create: `.env.example`
- Create: `.dev.vars.example`
- Create: `src/lib/supabase/config.js`
- Create: `src/lib/supabase/config.test.js`
- Create: `src/lib/supabase/client.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `import.meta.env.VITE_SUPABASE_URL`, `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`
- Produces: `readSupabaseConfig(env): { configured, url, publishableKey }` and `getSupabaseClient(): SupabaseClient | null`

- [ ] **Step 1: Write failing configuration tests**

```js
import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from './config';

describe('Supabase configuration', () => {
    it('is configured only when both browser values are present', () => {
        expect(readSupabaseConfig({})).toEqual({ configured: false, url: '', publishableKey: '' });
        expect(readSupabaseConfig({ VITE_SUPABASE_URL: ' https://p.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ' key ' })).toEqual({
            configured: true,
            url: 'https://p.supabase.co',
            publishableKey: 'key'
        });
    });
});
```

- [ ] **Step 2: Run the configuration test to verify it fails**

Run: `npx vitest run src/lib/supabase/config.test.js`

Expected: FAIL because the configuration module does not exist.

- [ ] **Step 3: Implement lazy browser client creation**

`readSupabaseConfig` trims both values and never throws. `getSupabaseClient` returns `null` when configuration is absent and otherwise memoizes `createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })`.

- [ ] **Step 4: Create the profiles schema and authorization helpers**

The migration creates:

```sql
create type public.app_role as enum ('admin', 'approver', 'user');

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text not null default '',
    department text not null default '',
    role public.app_role not null default 'user',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
```

Add a `security definer set search_path = ''` signup trigger that always assigns `user`, an `is_admin()` SQL helper, RLS policies for self-read and administrator access, no `anon` grants, authenticated `select`, and column-restricted updates for `display_name` and `department`. The SQL test wraps assertions in a transaction and verifies anonymous denial, self-read, cross-user denial, and administrator read access.

- [ ] **Step 5: Add credential examples without values**

```dotenv
# .env.example
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

```dotenv
# .dev.vars.example
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

- [ ] **Step 6: Install and verify the Supabase client**

Run: `npm install @supabase/supabase-js && npx vitest run src/lib/supabase/config.test.js && npm run build`

Expected: configuration tests pass and the production build succeeds with no secret value embedded by repository files.

- [ ] **Step 7: Commit and push the Supabase foundation**

```powershell
git add package.json package-lock.json .env.example .dev.vars.example supabase src/lib/supabase
git commit -m "feat: add Supabase schema and client"
git push origin main
```

### Task 4: Implement Authentication State and Login

**Files:**
- Create: `src/stores/auth.js`
- Create: `src/stores/auth.test.js`
- Create: `src/views/auth/LoginView.vue`
- Create: `src/views/auth/SetupRequiredView.vue`
- Create: `src/views/auth/AccessDeniedView.vue`
- Create: `src/views/auth/auth-views.test.js`

**Interfaces:**
- Consumes: `getSupabaseClient()` and Supabase auth/session/profile responses
- Produces: `useAuthStore()` with `initialize()`, `signIn(email, password)`, `signOut()`, `hasRole(roles)`, `session`, `user`, `profile`, `role`, `loading`, `initialized`, `configured`, and `error`

- [ ] **Step 1: Write failing auth-store state tests**

Test with an injected fake client that initializes from an existing session, loads an `approver` profile, recognizes `admin` or `approver` access, signs out, and clears session state. Also assert that an unconfigured store initializes without throwing and rejects sign-in with `Supabase 연결 정보가 설정되지 않았습니다.`.

- [ ] **Step 2: Run the auth-store tests to verify they fail**

Run: `npx vitest run src/stores/auth.test.js`

Expected: FAIL because the auth store does not exist.

- [ ] **Step 3: Implement the auth store**

`createAuthStore({ client, configured })` owns the testable implementation. `useAuthStore()` returns one browser singleton. Initialization calls `auth.getSession`, subscribes with `onAuthStateChange`, and loads `profiles` for the user. `signIn` calls `signInWithPassword`; `signOut` clears local profile state after Supabase succeeds. Errors are normalized to stable Korean messages without logging credentials or tokens.

- [ ] **Step 4: Write failing mounted login tests**

Mount `LoginView` with a memory router and mocked store. Assert required email/password errors, disabled loading state, sign-in invocation, displayed server error, and redirect to a validated local `redirect` query path.

- [ ] **Step 5: Replace the Sakai demo login with NEXERP auth views**

Build a PrimeVue login page using the existing NEXERP mark, Korean labels, password reveal, submit validation, an `aria-live` error summary, and no signup link. `SetupRequiredView` lists the two required browser variable names without values. `AccessDeniedView` explains the missing permission and provides a dashboard command.

- [ ] **Step 6: Run auth tests and accessibility assertions**

Run: `npx vitest run src/stores/auth.test.js src/views/auth/auth-views.test.js`

Expected: auth state and mounted form tests pass; labels, errors, and focus behavior are asserted.

- [ ] **Step 7: Commit and push authentication components**

```powershell
git add src/stores/auth.js src/stores/auth.test.js src/views/auth
git commit -m "feat: add Supabase authentication flow"
git push origin main
```

### Task 5: Protect Routes and Connect the User Menu

**Files:**
- Create: `src/router/authGuard.js`
- Create: `src/router/authGuard.test.js`
- Modify: `src/router/index.js`
- Modify: `src/layout/AppTopbar.vue`
- Modify: `src/layout/erp-shell.test.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `useAuthStore()` and route meta `public`, `guestOnly`, and `roles`
- Produces: `createAuthGuard(authStore)` and authenticated route behavior

- [ ] **Step 1: Write failing guard decision tests**

Cover unconfigured redirect to `setup-required`, anonymous redirect to `login` with the original path, an ordinary user denied from approvals, and allowed authenticated navigation. Use separate store fixtures for each state.

- [ ] **Step 2: Run the guard tests to verify they fail**

Run: `npx vitest run src/router/authGuard.test.js`

Expected: FAIL because the guard module does not exist.

- [ ] **Step 3: Implement and register route guards**

Add public routes `/auth/login`, `/auth/setup`, and `/auth/access-denied` outside `AppLayout`. Register `router.beforeEach(createAuthGuard(useAuthStore()))`. Mark `/approvals` for `admin` and `approver`, and `/settings/access` for `admin`. Validate login redirects by accepting only strings beginning with a single `/` and rejecting protocol-relative paths.

- [ ] **Step 4: Write failing topbar integration assertions**

Assert that `AppTopbar.vue` reads `profile`, uses a computed display name and department, calls `signOut`, routes to login after success, and no longer contains fixed `김서준`, `영업관리팀`, or the demo logout message.

- [ ] **Step 5: Connect the topbar profile and logout command**

Use profile initials and fallback email for the avatar/name, show the persisted department, hide the user-access command unless `hasRole(['admin'])`, and make logout await `signOut()` before `router.replace({ name: 'login' })`. Surface failure through the existing Toast service.

- [ ] **Step 6: Run route, shell, and full tests**

Run: `npx vitest run src/router/authGuard.test.js src/layout/erp-shell.test.js && npm test -- --run`

Expected: guard scenarios, dynamic topbar assertions, and the complete inherited suite pass.

- [ ] **Step 7: Commit and push protected navigation**

```powershell
git add src/router src/layout/AppTopbar.vue src/layout/erp-shell.test.js src/main.js
git commit -m "feat: protect ERP routes by Supabase role"
git push origin main
```

### Task 6: Add Authenticated Worker Profile API and ERP Repository Boundary

**Files:**
- Create: `worker/supabase.js`
- Create: `worker/auth.js`
- Create: `worker/auth.test.js`
- Create: `worker/backup/capability.js`
- Create: `worker/backup/capability.test.js`
- Create: `src/repositories/erp/demoErpRepository.js`
- Create: `src/repositories/erp/index.js`
- Create: `src/repositories/erp/repository.test.js`
- Modify: `worker/app.js`
- Modify: `worker/app.test.js`
- Modify: `src/stores/erp.js`
- Modify: `src/stores/erp.test.js`

**Interfaces:**
- Consumes: bearer token, Worker Supabase bindings, existing ERP seed data
- Produces: `getBearerToken(request)`, `createUserSupabaseClient(env, token)`, `GET /api/me`, `createDemoErpRepository()`, `setErpRepository(repository)`, and `getBackupCapability()`

- [ ] **Step 1: Write failing `/api/me` tests**

Assert `401 missing_authorization` without a bearer token, `401 invalid_session` when `auth.getUser(token)` fails, `403 inactive_user` for an inactive profile, and `200` with only `{ id, email, displayName, department, role }` for a valid active user. Inject `createSupabaseClient` into `createWorkerApp` so tests never call a live service.

- [ ] **Step 2: Run Worker auth tests to verify they fail**

Run: `npx vitest run worker/auth.test.js worker/app.test.js`

Expected: FAIL because bearer parsing and `/api/me` are absent.

- [ ] **Step 3: Implement user-scoped Supabase access**

`getBearerToken` accepts exactly `Bearer <non-empty-token>`. `createUserSupabaseClient` creates a non-persistent client with `global.headers.Authorization` set to the incoming bearer value. `/api/me` first verifies the token with `auth.getUser(token)`, then reads the matching profile through the same user-scoped client so RLS applies. Map upstream errors to the stable envelope without returning their raw messages.

- [ ] **Step 4: Write failing ERP repository contract tests**

Assert that `createDemoErpRepository()` returns cloned order, approval, and route-specific generic records. Assert that `setErpRepository` rejects objects missing `listOrders`, `listApprovals`, or `listGenericRecords`.

- [ ] **Step 5: Move demo reads behind the repository contract**

`createDemoErpRepository` clones seed arrays and returns fresh records. `src/stores/erp.js` initializes and resets through the configured repository while preserving its public store API and order-number monotonicity. No Supabase ERP table implementation is added in this phase.

- [ ] **Step 6: Add the explicit deferred backup capability**

```js
export function getBackupCapability() {
    return Object.freeze({ enabled: false, provider: 'r2', destructiveCleanup: false });
}
```

The test asserts this exact immutable value. No scheduled handler, R2 binding, export, or deletion code is present.

- [ ] **Step 7: Run Worker and ERP state suites**

Run: `npx vitest run worker src/repositories/erp src/stores/erp.test.js && npm test -- --run`

Expected: API error cases, repository contracts, backup boundary, and all ERP behavior pass.

- [ ] **Step 8: Commit and push API and repository boundaries**

```powershell
git add worker src/repositories src/stores/erp.js src/stores/erp.test.js
git commit -m "feat: add authenticated API and data boundaries"
git push origin main
```

### Task 7: Document Setup and Perform End-to-End Verification

**Files:**
- Modify: `README.md`
- Create: `docs/setup/cloudflare-supabase.md`
- Create: `docs/setup/fresh-machine.md`
- Create: `docs/setup/setup-docs.test.js`

**Interfaces:**
- Consumes: all scripts, variables, migrations, routes, and Worker endpoints from Tasks 1-6
- Produces: reproducible local setup, deployment, and another-computer handoff instructions

- [ ] **Step 1: Write a documentation verification test**

Read all three documents and assert they contain the exact commands `npm ci`, `npm test -- --run`, `npm run dev`, `npm run dev:cloudflare`, `npx supabase db push`, `npx wrangler secret put`, `npm run deploy`, and `git pull --ff-only origin main`.

- [ ] **Step 2: Run the documentation test to verify it fails**

Run: `npx vitest run docs/setup/setup-docs.test.js`

Expected: FAIL because the setup documents do not exist.

- [ ] **Step 3: Write reproducible setup and deployment documentation**

Document cloning and fresh-machine installation, environment-file creation, Supabase CLI linking and migrations, first-admin promotion SQL, Wrangler login and deployment, publishable versus secret key handling, current demo repository behavior, deferred R2 scope, verification, and handoff commands.

- [ ] **Step 4: Run all automated checks**

```powershell
npm test -- --run
npm run build
npx eslint src worker --quiet
npx wrangler deploy --dry-run
npm audit --omit=dev
git diff --check
```

Expected: every command exits 0. The existing Vite large-chunk advisory may remain informational.

- [ ] **Step 5: Browser-smoke-test both configuration states**

Without `.env`, confirm `/` redirects to `/auth/setup`, the setup screen names both required variables, and no console error occurs. With mocked or user-provided non-production credentials, confirm anonymous redirect to `/auth/login`, invalid credentials retain focus and show a Korean error, successful login restores the requested route, denied roles reach `/auth/access-denied`, the topbar shows the profile, and logout returns to login. Verify desktop and 390px mobile layouts without horizontal overflow.

- [ ] **Step 6: Commit, push, and verify the handoff point**

```powershell
git add README.md docs/setup
git commit -m "docs: add Cloudflare Supabase operations guide"
git push origin main
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

Expected: the working tree is clean and the final two hashes are identical.
