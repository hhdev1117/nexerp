# NEXERP

NEXERP is a single-company ERP built on Vue 3, PrimeVue, Cloudflare Workers Static Assets, and Supabase authentication. Roles are `admin`, `approver`, and `user`. Business records currently use the in-memory demo repository and are not yet persisted to Supabase.

## Quick Start

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` before enabling Supabase authentication. Never commit `.env.local`, `.dev.vars`, credentials, or tokens.

Detailed instructions:

- [Cloudflare and Supabase operations](docs/setup/cloudflare-supabase.md)
- [Fresh-machine setup and handoff](docs/setup/fresh-machine.md)

## Verify

```bash
npm test -- --run
npm run build
```

The Sakai Vue base and its MIT license are documented in [LICENSE.md](LICENSE.md).
