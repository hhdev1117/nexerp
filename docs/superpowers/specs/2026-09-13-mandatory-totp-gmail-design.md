# Mandatory Google Authenticator And Gmail Provisioning Design

## Goal

Require every active NEXERP account to complete TOTP multi-factor authentication
and allow administrators to create new accounts only with `@gmail.com` addresses.
Google OAuth is not part of this change; password plus Google Authenticator is the
login method.

## Authentication Policy

- A password-authenticated session is AAL1 and cannot enter ERP routes.
- An active account without a verified TOTP factor is sent to mandatory setup.
- An active account with a verified factor but an AAL1 session is sent to the
  six-digit challenge screen.
- Only an AAL2 session may enter ERP routes or call administrator Worker APIs.
- MFA lookup errors fail closed and expose only stable Korean messages.
- QR SVG, `otpauth` URI, secret, challenge identifiers, and provider errors are
  never logged or persisted. Enrollment state exists only in memory and is
  cleared after verification, cancellation, sign-out, or identity change.

## User Experience

- `/auth/mfa` presents either setup or verification without exposing ERP content.
- Setup displays the Supabase-generated QR code, a user-controlled manual-key
  reveal, and a six-digit code field compatible with Google Authenticator.
- The profile menu links to `/settings/security`, where users can add a backup
  authenticator and remove old authenticators. The last verified factor cannot be
  removed because MFA is mandatory.
- An administrator can reset another account's TOTP factors from account
  management after confirmation. Self-reset is forbidden. The target is signed
  out and must enroll again.
- Supabase does not provide stable recovery codes for this flow; a second TOTP
  device is the supported self-service recovery method.

## Gmail-Only Provisioning

- Admin account creation normalizes email to lowercase and accepts only a nonempty
  local part followed by exactly `@gmail.com`.
- The browser and Worker enforce the same validation and message.
- The Auth user trigger also requires `@gmail.com` and an administrator-only app
  metadata marker, preventing direct public signup from bypassing ERP account
  management.
- Existing pre-migration accounts remain usable and must enroll TOTP; they are not
  renamed or deleted.

## Server And Database Enforcement

- `authorizeAdministrator` verifies the request JWT's AAL and returns a redacted
  `403 mfa_required` before administrator work when it is not `aal2`.
- PostgreSQL exposes `private.is_aal2()` and makes `private.is_admin()` depend on
  it, so security-definer administrator RPCs and administrator read policies
  require AAL2.
- Role-menu permissions require AAL2. A user's own active profile remains readable
  at AAL1 solely so the app can decide whether mandatory enrollment is allowed.
- Local Supabase configuration explicitly enables TOTP enrollment and verification.

## Verification And Rollout

Store, guard, route, UI, Worker, and SQL migration tests cover enrollment,
challenge, failure redaction, stale sessions, Gmail validation, AAL enforcement,
factor reset, and last-factor protection. Apply the migration before deploying the
frontend/Worker, then enroll the administrator in production and confirm a second
login challenge before declaring rollout complete.

