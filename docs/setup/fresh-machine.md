# Fresh-Machine Setup and Handoff

These steps reproduce NEXERP on another computer without transferring secret files.

## Install and Clone

Install Git and a current Node.js LTS release, then clone the canonical repository:

```bash
git clone https://github.com/hhdev1117/nexerp.git
cd nexerp
git pull --ff-only origin main
npm ci
```

`npm ci` uses the committed lockfile and should be used for reproducible setup. Do not copy `node_modules`, `dist`, `.wrangler`, or `.supabase` from another machine.

## Create Local Configuration

Create local files from the examples:

```powershell
Copy-Item .env.example .env.local
Copy-Item .dev.vars.example .dev.vars
```

Obtain the project URL, publishable key, and Worker-only secret key through an approved credential channel. Put only the browser URL and publishable key in `.env.local`; put Worker values in `.dev.vars`. Never commit either file. `SUPABASE_SECRET_KEY` must never use a `VITE_*` name or enter browser code.

To run the UI without any credentials, leave `.env.local` absent and start Vite. The application will route to its setup-required screen:

```bash
npm run dev
```

After local values are configured, test the Worker-integrated build with:

```bash
npm run dev:cloudflare
```

## Link External Services

Only an operator authorized for the target Supabase and Cloudflare projects should link or deploy. Follow the migration-history gate in [Cloudflare and Supabase operations](cloudflare-supabase.md) before any database push. The production history is not yet reconciled, so a fresh machine must not run `npx supabase db push` merely because the repository was linked. Configure Worker secrets with:

```bash
npx wrangler secret put SUPABASE_URL --name nexerp
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --name nexerp
npx wrangler secret put SUPABASE_SECRET_KEY --name nexerp
```

Values are entered only at the interactive prompts. Login IDs map to internal Auth addresses in the form `<login_id>@nexerp.internal`; operators and users never promote accounts by editing an email in SQL. Bootstrap the first administrator once with the trusted `npm run bootstrap:admin` command and server-only credentials from the operations guide. `/api/me` exposes `loginId`, not email, and every account must complete mandatory TOTP enrollment. After bootstrap, administrators manage accounts and role-based menu access from the NEXERP system-management screens.

## Verify and Deploy

Before handoff, run:

```bash
npm test -- --run
npx eslint src worker docs --quiet
npm run build
npx wrangler deploy --dry-run
npm audit --omit=dev
git diff --check
```

An authorized operator can deploy after all checks pass:

```bash
npm run deploy
```

Confirm the deployed `/api/health` response, login redirect behavior, role restrictions, administrator account and menu-permission screens, profile display, and logout. Do not treat demo ERP records as durable data, and do not report R2 backup as enabled.

## Continue Work on Another Computer

The handoff point is a reviewed commit on `origin/main`, not an uncommitted directory or a copied environment file. On the receiving computer:

```bash
git switch main
git pull --ff-only origin main
npm ci
npm test -- --run
git status --short
```

`git status --short` should be empty before new work begins. Exchange required credentials only through the approved secret manager or provider access flow. If a credential is sent through source control, logs, or chat, follow the rotation and incident steps in the operations guide before continuing.
