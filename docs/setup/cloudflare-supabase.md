# Cloudflare and Supabase Operations

This guide configures the NEXERP frontend, Worker, database migration, and deployment. Use placeholders until entering values through an authorized local or provider session. Do not paste credentials into source files, issue trackers, chat, terminal output, screenshots, or logs.

## Credential Boundaries

The browser uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A Supabase publishable key is designed to be browser-visible; Row Level Security remains the data authorization boundary. Never put a secret key, service-role key, direct database password, or access token in a `VITE_` variable.

The Worker uses `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for user-scoped requests. It forwards the signed-in user's bearer token so Supabase evaluates those requests under that user and applies RLS. Account creation additionally uses `SUPABASE_SECRET_KEY` only after the Worker validates the caller and verifies an active `admin` profile. The secret key is server-only and must never enter browser code, a `VITE_*` variable, a response, or a log.

The administrator-only infrastructure screen uses `SUPABASE_MANAGEMENT_TOKEN` for allowlisted Supabase Management API health and usage reads, and `CLOUDFLARE_API_TOKEN` for Cloudflare Workers analytics and allowlisted script settings. Both are Worker-only secrets. The Cloudflare token needs the narrow analytics-read permission and `Workers Scripts Read` for the configured account, while the Supabase token needs project, health, analytics usage, and disk configuration read permissions. The nonsecret Cloudflare account and Worker names are committed as Worker vars.

`SUPABASE_MANAGEMENT_TOKEN` is therefore read-scoped on purpose and cannot change the database. Confirmed on 2026-09-15: `POST /v1/projects/<ref>/database/query` connects as `supabase_read_only_user` with `transaction_read_only=on`, so every DDL statement fails with `25006: cannot execute ... in a read-only transaction` regardless of a `read_only` request field, and the migration-applying endpoint `POST /v1/projects/<ref>/database/migrations` returns `403`. Do not widen this token to apply schema changes. Schema changes belong to an authorized operator working in the Supabase SQL Editor, and the same token still serves every verification read afterwards.

For local development, create ignored files from the committed examples:

```powershell
Copy-Item .env.example .env.local
Copy-Item .dev.vars.example .dev.vars
```

Replace the placeholders locally. Do not commit either file. `.env.local` configures the Vite browser client; `.dev.vars` configures the local Worker.

## Supabase Setup

For a new project whose migration history has always been managed by the CLI, authenticate, link the repository, and apply committed migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

### Production Migration-History Blocker

The current production project is `mehhrnbaiojivesnobpv` (`nexerp`). Several migrations were applied through the authorized SQL Editor and their resulting schema was verified from PostgreSQL catalogs. That direct SQL execution did not establish CLI migration history, and the available management token reached the linked project but failed during CLI login-role initialization with HTTP `403`.

A 2026-09-15 read through `GET /v1/projects/<ref>/database/migrations` supersedes the earlier report that `supabase_migrations.schema_migrations` was absent. A ledger now exists, and it disagrees with the live schema in both directions, so neither source may be trusted alone:

| Divergence | Versions |
|---|---|
| Recorded in the ledger but with no committed migration file | `20260915000100 add_login_ids`, `20260915000200 bootstrap_first_admin`, `20260915000300 add_provisioning_nonces`. `public.login_ids` does not exist in the live schema |
| Present in the live schema but absent from the ledger | `20260914000300`, `20260914000400`, `20260914000500`, `20260914000600`, `20260914000700`, `20260915000800`, `20260915000900`, `20260915001100` |

Do not run `npx supabase db push` against `mehhrnbaiojivesnobpv` until an authorized operator has reconciled every manually applied version; a push against the ledger above would replay eight migrations that are already live. First compare each committed migration with the live catalog. For each version confirmed as already applied, use the official tracking-only command `npx supabase migration repair --status applied <VERSION>`, then require `npx supabase migration list --linked` to succeed and show the expected local/remote versions. Investigate the three ledger-only versions before repairing anything, because a version recorded as applied whose objects are missing indicates either a rollback or a ledger written from another branch. The repository now carries eighteen migration files; that inventory is not proof that every version is present remotely. Do not fabricate `supabase_migrations` tables or rows, and do not mark a version applied without the catalog comparison.

### Applying a Pending Migration

Until CLI history is reconciled, an authorized operator applies a committed migration by pasting the whole file into the Supabase SQL Editor as one execution, in ascending version order. Two migrations are pending as of 2026-09-15: `20260915001200_add_audit_logs.sql` then `20260915001300_add_document_sequences.sql`. The first creates the shared change ledger and attaches `private.record_audit()` to `companies`, `sites` and `partners`; the second creates `public.document_sequences` and `private.next_document_number()`. Both are safe to apply while the three master tables hold no rows.

Verify afterwards with catalog reads, which the read-scoped management token can perform: `public.audit_logs` and `public.document_sequences` exist with row-level security enabled, `authenticated` holds no `INSERT`, `UPDATE` or `DELETE` grant on either table, each table has exactly one select policy, three triggers reference `private.record_audit`, and `authenticated` cannot execute `private.next_document_number`.

The migrations create `profiles`, the `admin`/`approver`/`user` role type, account and menu-permission RPCs, signup triggers, explicit grants, and RLS policies. New accounts always begin with the `user` role until an authorized administrator assigns another role.

They also create the `companies`, `sites`, and `partners` master tables. Any active, MFA-verified user can read them; only administrators can insert or update rows, and nothing can be deleted. Deactivate a company, site, or partner instead. Deactivating a company automatically deactivates its sites, and inactive companies cannot receive or reactivate active partners. Partner codes are immutable after creation. Register companies and sites from `회사 · 사업장`, and manage customer/vendor roles in the unified `master.partners` screen (`거래처 관리`).

After the intended first administrator has created an account, replace the placeholder below with that account's exact, already-known email. Run this read-only preflight in an authorized Supabase SQL Editor and confirm that it returns exactly one active profile with the expected identity:

```sql
select id, email, role, is_active
from public.profiles
where email = 'FIRST_ADMIN_EMAIL@example.invalid';
```

Only after the preflight is correct, replace the same placeholder in the block below and submit the entire block as one SQL Editor execution. Do not run its statements separately. The update is restricted to an active profile with the exact email, and the transaction raises an exception instead of committing unless exactly one row is updated.

```sql
begin;

do $$
declare
    affected_rows integer;
begin
    update public.profiles
    set role = 'admin'::public.app_role
    where email = 'FIRST_ADMIN_EMAIL@example.invalid'
      and is_active = true;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
        raise exception 'Expected exactly one active profile; updated % rows.', affected_rows;
    end if;
end
$$;

commit;
```

Re-run the read-only preflight and confirm that the one intended profile now has role `admin`. If the guarded transaction raises an exception, investigate the account identity or active state; do not loosen the email or active-account conditions.

After the bootstrap administrator is verified, create and maintain subsequent accounts from NEXERP's `계정 관리` screen. Configure role-based navigation from `메뉴 권한 관리`; do not use dashboard-side profile edits as the routine account-management workflow.

## Local Development

Run the Vite frontend for normal UI development:

```bash
npm run dev
```

Run the production build behind the local Cloudflare Worker when testing `/api/*`, static assets, and SPA fallback together:

```bash
npm run dev:cloudflare
```

With no `.env.local`, navigation to `/` deliberately redirects to `/auth/setup`, where the two required browser variable names are shown. With browser configuration present, an anonymous protected request redirects to `/auth/login` and preserves its local destination.

## Worker API

`GET /api/health` returns HTTP `200` with `supabase: configured` when both Worker bindings exist. Missing bindings return HTTP `503` with `supabase: missing_configuration`. Responses never disclose binding values and always use `cache-control: no-store`.

`GET /api/me` requires one valid `Bearer` access token. Its stable status categories are:

- `200`: active profile, returning only id, email, display name, department, and role.
- `401`: missing authorization or invalid session.
- `403`: missing or inactive profile.
- `503`: missing Worker configuration.
- `502`: retryable or upstream Supabase failure.

Unknown `/api/*` paths return `404`. Client responses omit raw Supabase errors, credentials, and token values.

Active administrators can use `GET /api/admin/accounts`, `POST /api/admin/accounts`, and `PATCH /api/admin/accounts/:id`. These endpoints validate the caller before account operations, return only whitelisted profile fields, and normalize provider failures without exposing credentials. Account creation requires the Worker-only secret key; listing and profile updates retain the signed-in user's authorization boundary.

`GET /api/admin/infrastructure/usage?range=24h` and `range=7d` validate an active administrator before provider access. The response contains only normalized service states and usage metrics. Cloudflare CPU quantiles retain the provider's raw microsecond unit as `cpuTimeUs`; the UI explicitly converts those values to milliseconds, separately from the configured `cpuMs` limit. `responseBytes` remains `null` with `metric_unavailable` until that capability can be discovered from a verified schema, and no unsupported response-size field is queried. Cloudflare Analytics is sampled operational telemetry and may differ from 청구 사용량; the screen does not estimate quotas, remaining capacity, or provider billing. Missing configuration or a provider outage remains isolated to that provider and never exposes project references, account identifiers, URLs, tokens, raw errors, headers, bindings, or annotations.

## Cloudflare Deployment

Authenticate Wrangler in the intended Cloudflare account:

```bash
npx wrangler login
```

Enter Worker values interactively so they do not appear in committed configuration. Run each command separately and provide the matching value only at Wrangler's prompt:

```bash
npx wrangler secret put SUPABASE_URL --name nexerp
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --name nexerp
npx wrangler secret put SUPABASE_SECRET_KEY --name nexerp
npx wrangler secret put SUPABASE_MANAGEMENT_TOKEN --name nexerp
npx wrangler secret put CLOUDFLARE_API_TOKEN --name nexerp
```

Validate the Worker bundle without deploying, then build and deploy:

```bash
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

After deployment, check `/api/health` at the assigned Worker domain. Exercise `/api/me` through the application or a protected diagnostic process that does not print or persist the bearer token.

## Data and Backup Scope

The current `createDemoErpRepository()` implementation supplies cloned in-memory orders, approvals, and generic route records. Supabase persists authentication identities, profiles, role-menu permissions, companies, sites, and partners. ERP transaction records still reset with the demo state and are not persisted to Supabase yet.

The R2 capability boundary is explicitly disabled (`enabled: false`, `destructiveCleanup: false`). R2 bindings, scheduled exports, retention, purge, restore, encryption, lifecycle policy, and destructive cleanup are all deferred. Do not infer backup coverage from the presence of the boundary module.

## Verification

Run the complete credential-free verification set before deployment or handoff:

```bash
npm test -- --run
npx eslint src worker docs --quiet
npm run build
npx wrangler deploy --dry-run
npm audit --omit=dev
git diff --check
```

The Vite large-chunk advisory is informational. Any failing command, production vulnerability, secret-like value, or unexpected R2 implementation blocks deployment.

## Rotation and Incidents

When rotating the Supabase publishable key, update `.env.local`, local `.dev.vars`, and the corresponding deployed Worker value; rebuild and redeploy the frontend so browser and Worker configuration change together. Rotate `SUPABASE_SECRET_KEY` separately in local `.dev.vars` and the Cloudflare Worker secret store without placing it in browser configuration. Revoke an old key in Supabase only after the replacement deployment is verified.

For suspected exposure, do not print the suspected value while investigating. Revoke or rotate it at its provider, invalidate affected user sessions when tokens may be exposed, replace local and deployed values, redeploy, and review provider audit logs plus repository history. A server secret outside ignored local Worker configuration or the Cloudflare secret store is an incident.
