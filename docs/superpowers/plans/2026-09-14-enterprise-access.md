# Enterprise Access Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development to execute and review bounded tasks.

**Goal:** Implement company-scoped permission levels, position mappings, user grants and explainable access with a real persistence boundary and management UI.
**Architecture:** Keep legacy access until each resource is explicitly migrated. Add normalized policy tables, atomic administrator RPCs, a pure decision engine, repository and management screen.
**Tech Stack:** Vue 3, PrimeVue 4, Supabase Postgres/RLS, Vitest.
**Spec:** ../specs/2026-09-14-enterprise-access-design.md and enterprise-access-ui-design.md.

## Constraints

- No automatic conversion of existing admin into company representative.
- Position overrides grade; explicit assignment overrides both; deny wins only for matching action and scope.
- Missing company membership, unsupported scope and inactive identity fail closed.
- Preserve legacy modules until server and client migration is verified; no claim that storing policy activates legacy APIs.

## Tasks

- [x] 1. Pure policy engine and tests: src/data/enterpriseAccess.js/test.js. Export createDefaultPolicy(resources), resolveLevel(policy, member, asOf), explainAccess(policy, request). Policy contains levels, mappings, members, roles, overrides; request binds actor, company, action, resource and subject scope. Test grade/position precedence, interval expiry, company crossing, action-scope separation, deny and module-disabled.
- [x] 2. Persistence: company policy snapshot and revision audit tables and atomic RPCs in supabase migration; protect writes with active AAL2 system admin, validate FK/company and revision, keep audit. Add SQL and JS tests. Repository contract load(companyId), save(companyId, policy, revision, reason) returns {policy,revision}; no demo fallback for configured production failures.
- [x] 3. Four-tab management UI in src/views/admin/EnterpriseAccess.vue with company selection, levels/actions, mappings, memberships/overrides and explain. Connect repository, revision conflict and unsaved draft protection. Add dedicated admin-only menu/route without replacing existing access settings before migration.
- [x] 4. Integration review and verification: targeted tests then full Vitest, ESLint, build; inspect SQL execution availability. Document exact active vs not migrated behavior and operations steps. Review all new files and fix defects before reporting.

## Execution ledger

Ruling: The full ERP is largely demo data. Keep its legacy authorization intact while the new policy management and decision service are introduced; explicit resource migration must not silently weaken existing server gates.

Ruling: Persist the reviewed configuration as one strict JSON policy snapshot with revision audit in this first implementation. Normalized HR-backed assignments and active authorization cutover remain explicitly unimplemented; see docs/setup/enterprise-access.md. This avoids claiming nonexistent HR source-of-truth integration.

Review: Independent engine/storage/UI reviews completed; date contracts, unknown resources, conflict recovery, multi-scope edits and blank-account linkage corrected. Actual Vue UI rendered at 1440px and 375px with isolated fixtures, no overflow or page errors. Local PGlite migration and 20 runtime assertions passed; full Supabase pgTAP remains unexecuted.
