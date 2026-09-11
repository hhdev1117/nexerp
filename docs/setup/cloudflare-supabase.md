# Cloudflare and Supabase Operations

This guide configures the NEXERP frontend, Worker, database migration, and deployment. Use placeholders until entering values through an authorized local or provider session. Do not paste credentials into source files, issue trackers, chat, terminal output, screenshots, or logs.

## Credential Boundaries

The browser uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A Supabase publishable key is designed to be browser-visible; Row Level Security remains the data authorization boundary. Never put a secret key, service-role key, direct database password, or access token in a `VITE_` variable.

The Worker uses only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in this phase. It forwards the signed-in user's bearer token so Supabase evaluates requests under that user and applies RLS. No service-role key is required or used.

For local development, create ignored files from the committed examples:

```powershell
Copy-Item .env.example .env.local
Copy-Item .dev.vars.example .dev.vars
```

Replace the placeholders locally. Do not commit either file. `.env.local` configures the Vite browser client; `.dev.vars` configures the local Worker.

## Supabase Setup

Authenticate the CLI, link the repository to the intended project, and apply committed migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates `profiles`, the `admin`/`approver`/`user` role type, the signup trigger, explicit grants, and RLS policies. New accounts always begin with the `user` role.

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

## Cloudflare Deployment

Authenticate Wrangler in the intended Cloudflare account:

```bash
npx wrangler login
```

Enter Worker values interactively so they do not appear in committed configuration. Run each command separately and provide the matching value only at Wrangler's prompt:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

Validate the Worker bundle without deploying, then build and deploy:

```bash
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

After deployment, check `/api/health` at the assigned Worker domain. Exercise `/api/me` through the application or a protected diagnostic process that does not print or persist the bearer token.

## Data and Backup Scope

The current `createDemoErpRepository()` implementation supplies cloned in-memory orders, approvals, and generic route records. Supabase currently persists authentication identities and profiles only; ERP business records reset with the demo state and are not persisted to Supabase yet.

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

When rotating the Supabase publishable key, update `.env.local`, local `.dev.vars`, and both deployed Worker secrets; rebuild and redeploy the frontend so browser and Worker configuration change together. Revoke the old key in Supabase only after the new deployment is verified.

For suspected exposure, do not print the suspected value while investigating. Revoke or rotate it at its provider, invalidate affected user sessions when tokens may be exposed, replace local and deployed values, redeploy, and review provider audit logs plus repository history. A service-role or database credential appearing anywhere in this project is an incident because neither is used by this phase.
