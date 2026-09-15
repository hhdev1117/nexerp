# NEXERP

NEXERP is a multi-company, multi-site ERP built on Vue 3, PrimeVue, Cloudflare Workers Static Assets, and Supabase authentication. Roles are `admin`, `approver`, and `user`. Company, site, and partner master data persist in Supabase (`companies`, `sites`, `partners`); the remaining transaction records still use the in-memory demo repository. Active MFA-verified users may read `master.partners`, while only administrators may create, edit, deactivate, or reactivate partners.

## Quick Start

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` before enabling Supabase authentication. Never commit `.env.local`, `.dev.vars`, credentials, or tokens.

The administrator infrastructure screen additionally requires the Worker-only `SUPABASE_MANAGEMENT_TOKEN` and `CLOUDFLARE_API_TOKEN`. Keep both only in local `.dev.vars` or Cloudflare's encrypted secret store; never expose them through a `VITE_` variable.

Detailed instructions:

- [Enterprise access policy configuration and rollout status](docs/setup/enterprise-access.md)

- [Cloudflare and Supabase operations](docs/setup/cloudflare-supabase.md)
- [Pending production migrations and how to apply them](docs/setup/pending-migrations.md)
- [Fresh-machine setup and handoff](docs/setup/fresh-machine.md)
- [Current state, conventions, and next tasks for parallel contributors](docs/HANDOFF.md)

## Verify

```bash
npm test -- --run
npm run build
```

The Sakai Vue base and its MIT license are documented in [LICENSE.md](LICENSE.md).
