# Fresh-Machine Setup and Handoff

These steps reproduce NEXERP on another computer without transferring secret files.

## Install and Clone

Install Git and a current Node.js LTS release, then clone the canonical repository:

```bash
git clone https://github.com/hhdev1117/nxe-erd.git
cd nxe-erd
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

Obtain the project URL and publishable key through an approved credential channel. Put browser values in `.env.local` and Worker-local values in `.dev.vars`. Never commit either file. The browser and Worker use the publishable key only; this phase does not use a service-role key, secret key, database password, or copied session token.

To run the UI without any credentials, leave `.env.local` absent and start Vite. The application will route to its setup-required screen:

```bash
npm run dev
```

After local values are configured, test the Worker-integrated build with:

```bash
npm run dev:cloudflare
```

## Link External Services

Only an operator authorized for the target Supabase and Cloudflare projects should link or deploy. Apply the database workflow from [Cloudflare and Supabase operations](cloudflare-supabase.md), including:

```bash
npx supabase db push
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

Values are entered only at the interactive prompts. Promote the first administrator only after verifying the exact account email and using the narrowly scoped SQL in the operations guide.

## Verify and Deploy

Before handoff, run:

```bash
npm test -- --run
npm run build
npx eslint src worker docs --quiet
npx wrangler deploy --dry-run
npm audit --omit=dev
git diff --check
```

An authorized operator can deploy after all checks pass:

```bash
npm run deploy
```

Confirm the deployed `/api/health` response, login redirect behavior, role restrictions, profile display, and logout. Do not treat demo ERP records as durable data, and do not report R2 backup as enabled.

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
