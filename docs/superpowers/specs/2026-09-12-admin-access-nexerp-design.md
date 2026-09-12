# NEXERP Administrator Access Design

## Goal

Create a real Supabase administrator account, add administrator-only account and menu-permission management, and standardize the deployable project name as `nexerp` across the application, Cloudflare Worker, Supabase display name, and GitHub repository.

## Scope

- Create an immediately usable administrator in Supabase Auth and promote its generated profile to `admin`.
- Replace the generic access-settings screen with administrator account management and role-based menu access management.
- Allow administrators to create accounts, edit display name and department, assign `approver` or `user` grades, and activate or deactivate accounts.
- Allow administrators to configure visible and routable ERP menus for `approver` and `user` grades.
- Keep administrator access to both management screens fixed so an administrator cannot lock the organization out.
- Rename package metadata, Worker name and URL, Supabase project display name, documentation, and GitHub repository to `nexerp`.
- Keep HR and payroll outside the ERP menu.

## Security Boundary

The browser never receives the Supabase secret key. Account creation runs only in the Cloudflare Worker with `SUPABASE_SECRET_KEY`; the Worker first validates the caller bearer token through a publishable-key client and verifies an active `admin` profile. The secret client is created only after that authorization succeeds.

Profile role and activation changes use a `SECURITY DEFINER` RPC that independently verifies the caller is an active administrator. Direct grants for `profiles.role` and `profiles.is_active` remain closed, preventing self-escalation through the existing self-profile update policy. The RPC rejects self-demotion and self-deactivation.

Menu permissions are an application navigation boundary, not a substitute for row-level security on future business tables. The sidebar and router both enforce the same stable `menuKey`; missing or failed permission loads deny non-administrator access. Administrator management routes retain a fixed `roles: ['admin']` policy and bypass dynamic menu settings.

## Data Model

`public.role_menu_permissions` stores one row per `app_role`:

- `role public.app_role primary key`
- `allowed_menu_keys text[] not null`
- `revision bigint not null default 1`
- `updated_at timestamptz not null`
- `updated_by uuid null`

All three roles are seeded. `admin` contains all known menu keys and is read-only in the management UI. `approver` initially receives all ordinary ERP menus including approvals; `user` receives all ordinary ERP menus except approvals. Both non-admin roles exclude administrator settings.

Authenticated active users may select only their role row; active administrators may select all rows. Direct writes are revoked. `public.admin_replace_role_menu_permissions(target_role, allowed_keys, expected_revision)` performs an atomic, optimistic-concurrency update for non-admin roles after checking `private.is_admin()`.

`public.admin_update_profile(target_id, display_name, department, role, is_active)` updates a profile only after the same administrator check and rejects changes that would deactivate or demote the calling administrator.

## Worker API

- `GET /api/admin/accounts` returns whitelisted profile fields for active administrators.
- `POST /api/admin/accounts` accepts email, temporary password, display name, department, and role. It creates an email-confirmed Supabase Auth user, then updates the trigger-created profile. A profile-update failure deletes the newly created Auth user as compensation.
- `PATCH /api/admin/accounts/:id` calls the protected profile RPC and returns whitelisted profile fields.

Validation returns stable Korean messages with `400`; missing or invalid sessions use `401`; non-admin and inactive callers use `403`; duplicate email uses `409`; missing server configuration uses `503`; upstream failures use `502`. Raw provider errors, tokens, passwords, and secret values are never returned or logged.

## Frontend

Every leaf in `erpMenu` receives a stable `menuKey` such as `sales.orders`. The access store loads the current role permission row, caches it in memory, and fails closed for non-admin users. A recursive helper removes forbidden leaves and empty parents from the sidebar. The router uses the same `menuKey` to block direct URL navigation.

The system menu contains two administrator-only leaves:

- `계정 관리` at `/settings/accounts`
- `메뉴 권한 관리` at `/settings/menu-permissions`

Account management uses PrimeVue DataTable, filters, Dialog, Select, ToggleSwitch, Toast, and ConfirmDialog. It supports account creation and inline profile/grade/activation editing. The current administrator cannot be demoted or deactivated.

Menu-permission management uses a role selector, grouped menu rows, ToggleSwitch controls, dirty-state feedback, reset, and save. The administrator role is visible as a locked reference; `approver` and `user` are editable.

## Naming

The canonical slug is exactly `nexerp`; the visible brand remains `NEXERP`. The new Worker is deployed as `nexerp` at `https://nexerp.merciful-chips.workers.dev`. After verification, the previous Worker is retired. The GitHub repository is renamed to `hhdev1117/nexerp`, and `origin` follows the renamed URL. Supabase keeps its immutable project reference but its dashboard display name becomes `nexerp`.

## Verification

- Unit tests cover menu keys/filtering, access-store fail-closed behavior, router enforcement, administrator screens, API validation/authorization/error redaction, and secret-client configuration.
- pgTAP covers permission-row visibility, direct-write denial, atomic updates, concurrency conflicts, admin lockout prevention, and profile RPC protection.
- Production build completes with Supabase browser configuration.
- Deployed `/api/health` reports Supabase configured; unauthenticated admin APIs reject access; the administrator can sign in and see both management screens.
- Desktop and mobile browser checks confirm no console errors or horizontal overflow.
