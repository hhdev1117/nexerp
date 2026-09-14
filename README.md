# NEXERP

NEXERP is a multi-company, multi-site ERP built on Vue 3, PrimeVue, Cloudflare Workers Static Assets, and Supabase authentication. Roles are `admin`, `approver`, and `user`. Company and site master data persist in Supabase (`companies`, `sites`); the remaining business records still use the in-memory demo repository.

## Quick Start

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` before enabling Supabase authentication. Never commit `.env.local`, `.dev.vars`, credentials, or tokens.

The first administrator is created once with `npm run bootstrap:admin` from a trusted operator workstation. The command requires server-only environment values and refuses to run after an active administrator exists. Follow the credential-safe PowerShell procedure in the operations guide, clear the temporary-password variable immediately, and complete mandatory TOTP enrollment at first login.

The administrator infrastructure screen additionally requires the Worker-only `SUPABASE_MANAGEMENT_TOKEN` and `CLOUDFLARE_API_TOKEN`. Keep both only in local `.dev.vars` or Cloudflare's encrypted secret store; never expose them through a `VITE_` variable.

Detailed instructions:

- [Cloudflare and Supabase operations](docs/setup/cloudflare-supabase.md)
- [Fresh-machine setup and handoff](docs/setup/fresh-machine.md)
- [Current state, conventions, and next tasks for parallel contributors](docs/HANDOFF.md)

## Verify

```bash
npm test -- --run
npm run build
```

The Sakai Vue base and its MIT license are documented in [LICENSE.md](LICENSE.md).
