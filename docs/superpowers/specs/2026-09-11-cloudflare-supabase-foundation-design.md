# Cloudflare and Supabase ERP Foundation Design

## Goal

Move NEXERP, derived from the MIT-licensed Sakai Vue template, into `D:\Users\vmfort\Desktop\ERP` and add a production-oriented Cloudflare and Supabase foundation for one company. This phase establishes deployment, authentication, authorization, database migrations, and API boundaries. It does not replace every mock ERP dataset or implement R2 backup retention.

## Scope

### Included

- Preserve the existing NEXERP and PrimeVue ERP UI and its current tests.
- Deploy the Vue SPA and API Worker together with Cloudflare Workers Static Assets.
- Configure SPA fallback routing while sending `/api/*` requests through the Worker.
- Connect the browser to Supabase with a publishable key.
- Add email and password authentication.
- Add `admin`, `approver`, and `user` application roles.
- Add route authentication and role guards.
- Add a typed client boundary for browser-side Supabase access.
- Add Worker endpoints for health and the current authenticated user.
- Add Supabase migrations for profiles, roles, triggers, grants, and RLS policies.
- Add local and deployed environment-variable documentation and examples.
- Introduce repository interfaces so mock ERP data can be migrated table by table later.
- Reserve a Worker module boundary for a future scheduled R2 backup process.

### Deferred

- R2 bucket creation, scheduled exports, retention, purge, restore, and encryption policy.
- Migration of all ERP modules from demo state to persistent Supabase tables.
- User invitation and password recovery administration screens.
- Audit-log retention rules and regulatory retention decisions.
- Production Cloudflare and Supabase resource creation when account credentials are unavailable.

## Architecture

### Cloudflare

Use one Cloudflare Worker deployment with Static Assets. The Vite-built `dist` directory serves the Vue SPA, `not_found_handling` is `single-page-application`, and `/api/*` invokes the Worker first. This keeps the frontend, API, environment bindings, and future R2/Cron bindings in one deployable unit.

The Worker exposes:

- `GET /api/health`: reports application and configuration readiness without returning secrets.
- `GET /api/me`: validates the bearer token with Supabase and returns the authenticated profile.
- A structured JSON error envelope for missing configuration, unauthorized access, validation failures, and upstream Supabase errors.

The Worker has no R2 binding or scheduled handler in this phase. A focused `worker/backup` boundary documents where that implementation will be added without coupling it to request routing.

### Supabase

The Vue client uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These values are browser-visible by design. Every exposed table uses explicit grants and Row Level Security.

Worker runtime bindings use `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to execute user-scoped requests with the caller's Authorization header. A future `SUPABASE_SECRET_KEY` may be added with `wrangler secret put` only for narrowly defined administrative or backup work. It is not required by normal user requests and must never enter the client bundle or committed files.

### Identity and Roles

Supabase Auth owns credentials and sessions. A public `profiles` table has a one-to-one foreign key to `auth.users` and stores display name, department, role, active state, and timestamps. A database trigger creates a default `user` profile when an account is created.

Role behavior:

- `admin`: manage all profiles and perform future administrative operations.
- `approver`: use normal ERP screens and perform approval actions.
- `user`: use authenticated ERP screens without privileged administration or approval actions.

RLS allows active users to read their own profile. Administrators can read and update all profiles. Role changes are not accepted from ordinary client updates. Authorization helpers centralize role checks so future ERP policies can reuse them.

## Frontend Flow

1. The app initializes the Supabase session before protected navigation resolves.
2. Anonymous users are redirected to `/auth/login` with the requested path preserved.
3. Email and password login creates a Supabase session and returns the user to the requested ERP route.
4. The auth store loads the profile and role, subscribes to auth-state changes, and exposes loading, authenticated, and configured states.
5. Protected routes require a session. Routes with role metadata additionally check the loaded profile.
6. The topbar displays the authenticated profile and performs a real sign-out.
7. Missing environment configuration shows a deliberate setup state instead of throwing during application startup.

The existing demo ERP store remains the default data source in this phase. New repository contracts separate reads and commands from view components; a mock implementation preserves the current demo while a Supabase implementation can replace one bounded module at a time.

## Data and Security Rules

- Enable RLS on every table created in an exposed schema.
- Grant only the operations required by `authenticated`; grant nothing to `anon` for ERP data.
- Never embed secret or service-role credentials in Vite variables.
- Validate bearer tokens in the Worker with Supabase Auth rather than trusting decoded JWT fields alone.
- Forward user context for normal database operations so RLS remains the authorization boundary.
- Return no connection strings, keys, stack traces, or Supabase internal error details to clients.
- Keep `.env`, `.dev.vars`, and Wrangler secret files ignored by Git.

## Configuration

Committed examples describe, but do not contain, credentials:

- `.env.example`: browser-visible Supabase URL and publishable key.
- `.dev.vars.example`: Worker-local Supabase URL and publishable key.
- `wrangler.jsonc`: Worker entry, compatibility date, static assets, SPA fallback, and `/api/*` routing.

Development commands will cover the normal Vite UI loop and a Wrangler-integrated full-stack loop. Deployment uses a production build followed by Wrangler deploy.

## Source Control and Handoff

`https://github.com/hhdev1117/nexerp.git` is the canonical remote repository. The default branch is `main`. Each completed implementation stage is committed and pushed after its tests pass so another computer can continue from a clean pull. Secrets, local environment files, build output, dependency directories, and temporary clone artifacts are never committed.

The README documents fresh-machine setup, required tool versions, environment-file creation, Supabase migration commands, local Worker development, verification, and deployment. Work is considered synchronized only after the corresponding commit exists on `origin/main`; uncommitted local state is not treated as a handoff point.

## Error Handling

- Frontend authentication operations normalize Supabase errors into Korean user-facing messages.
- Route guards distinguish unconfigured, unauthenticated, inactive, and unauthorized users.
- Worker handlers use stable error codes and HTTP statuses.
- Network failures retain the login form state and allow retry.
- Profile lookup failure signs the user out only when the session is invalid; transient server failures remain retryable.

## Testing and Verification

- Unit-test environment validation, auth-store transitions, role guards, and repository selection.
- Worker tests cover health, missing configuration, missing/invalid authorization, and authenticated profile responses with mocked Supabase calls.
- SQL policy tests or documented local assertions cover anonymous denial, self-profile reads, and administrator profile access.
- Preserve and run all existing ERP tests.
- Run ESLint, production build, Wrangler configuration validation, and dependency audit.
- Browser-smoke-test login, redirect restoration, sign-out, responsive navigation, and failure states.

Live Supabase and Cloudflare verification requires the user's project URL, publishable key, authenticated Cloudflare CLI session, and deployed environment bindings. Without those credentials, automated tests use controlled mocks and the application presents a configuration state.

## Migration Strategy

The existing ERP working tree is copied into the new repository without `node_modules`, `dist`, temporary clone artifacts, or its old local-only Git remote. Existing uncommitted ERP implementation files are preserved as project content. The destination repository remains the canonical project after migration.

Implementation proceeds in four bounded stages:

1. Migrate and verify the existing ERP baseline.
2. Add Cloudflare Worker and deployment configuration.
3. Add Supabase schema, client, authentication, and authorization.
4. Add repository boundaries, documentation, and end-to-end verification.

## Future R2 Backup Boundary

A later design will define source tables, export consistency, compression, encryption, manifest format, checksums, restore testing, R2 lifecycle rules, Supabase purge order, legal retention, and failure recovery. This phase adds no destructive data-deletion path.
