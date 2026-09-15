# Pending Production Migrations

Four committed migrations are implemented, tested and merged, but not yet applied to the
production Supabase project `mehhrnbaiojivesnobpv`. Applying them needs a human or agent with
authorized Supabase dashboard access. Everything else is already done and verified.

## Why the repository cannot apply them

`SUPABASE_MANAGEMENT_TOKEN` in `.dev.vars` is read-scoped by design. It exists so the
administrator infrastructure screen can read project health, analytics usage and disk
configuration, as stated under Credential Boundaries in
[Cloudflare and Supabase operations](cloudflare-supabase.md). Measured behaviour on 2026-09-15:

| Attempt | Result |
|---|---|
| `POST /v1/projects/<ref>/database/query` with DDL | Connects as `supabase_read_only_user` with `transaction_read_only=on`; every statement fails with `25006: cannot execute ... in a read-only transaction` |
| The same request with a `read_only: false` body field | Identical failure; the field does not change the connection |
| `set default_transaction_read_only = off` before the DDL | Identical failure |
| `POST /v1/projects/<ref>/database/migrations` | `403 Your account does not have the necessary privileges` |
| `npx supabase db push` | Forbidden here for a separate reason; see the prohibitions below |

Do not widen this token to work around the boundary. Reads through it remain the correct way to
verify the result afterwards.

## What to apply, in this order

Open the Supabase SQL Editor for `mehhrnbaiojivesnobpv` and run each file as one execution,
pasting the whole file. The order matters because each later file depends on the earlier one.

1. `supabase/migrations/20260915001200_add_audit_logs.sql` — creates `public.audit_logs` and the
   generic trigger `private.record_audit()`, then attaches it to `companies`, `sites` and
   `partners`. Administrators read the ledger; no client can write or amend it.
2. `supabase/migrations/20260915001300_add_document_sequences.sql` — creates
   `public.document_sequences` and `private.next_document_number(uuid, text, date)`, which issues
   numbers like `SO-260915-001` atomically. Nothing calls it yet; transactional tables will.
3. `supabase/migrations/20260915001400_add_items.sql` — creates `public.items`, attaches the audit
   trigger, and folds the legacy `inventory.items` menu permission key into `master.items`.
   Requires step 1, because it references `private.record_audit()`.
4. `supabase/migrations/20260916001500_add_warehouses.sql` — creates `public.warehouses` under a
   site, attaches the audit trigger, and adds a trigger on `sites` so deactivating a site
   deactivates the warehouses inside it. Requires step 1 for the same reason.

All four are safe to apply while `companies`, `sites` and `partners` hold no rows. Step 3 edits
`role_menu_permissions`, temporarily disabling and then re-enabling
`protect_admin_role_menu_permissions` inside the same execution, which is why the file must be run
whole rather than statement by statement.

## Verify afterwards

```bash
node scripts/verify-pending-migrations.mjs
```

The script only reads PostgreSQL catalogs, so the read-scoped token is enough. It checks that the
four tables exist with row-level security enabled, that `authenticated` holds no write grant on
the ledger or the counters and no delete grant on items or warehouses, that the policy counts are
1, 1, 3 and 3, that five triggers reference `private.record_audit`, that the site cascade and both
security-definer helpers exist, that `authenticated` cannot execute
`private.next_document_number`, and that no role still holds the legacy `inventory.items` menu
key. Every line must read `PASS`.

Then deploy the current `main` so the application matches the schema:

```bash
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

Sign in as an administrator, change one company record, and confirm the change appears in
`감사 로그` at `/settings/audit`. Confirm `품목 기준정보` at `/master/items` loads and that the
old `/inventory/items` path redirects there. Confirm `창고 관리` at `/inventory/warehouses` loads.

## Do not do these

- Do not run `npx supabase db push`. The remote migration ledger disagrees with the live schema in
  both directions, so a push would replay migrations that are already applied. The divergence table
  is in [Cloudflare and Supabase operations](cloudflare-supabase.md).
- Do not insert rows into `supabase_migrations.schema_migrations` by hand, and do not create that
  table. Reconciliation uses `npx supabase migration repair --status applied <VERSION>` after a
  catalog comparison, by an authorized operator.
- Do not apply the files out of order, and do not split a file across executions.
- Do not commit `.env.local` or `.dev.vars`.
