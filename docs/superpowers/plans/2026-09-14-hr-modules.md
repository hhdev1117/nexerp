# HR Module Settings Implementation Plan

> Use superpowers:subagent-driven-development for implementation and independent review.

**Goal:** Safe company-level HR enable/drain/read-only/disable and separate menu visibility.
**Architecture:** Migration006 state/audit/settings RPC, centralized HR gating and runtime hidden menu keys; admin recovery screen.
**Tech Stack:** Vue3/PrimeVue, Supabase/PostgreSQL, Vitest/PGlite.
**Spec:** ../specs/2026-09-14-hr-modules-design.md

- [x] SQL006 state registry/settings/audit/gates, cancellation state, HR directory flags and hiddenMenuKeys. PostgreSQL tests first red then green for admin gate, state transitions, pending blockers, cancellation in draining, direct RPC deny, employment rights retained, visibility separate, revision/availability validation.
- [x] Runtime/HR repository/store contracts, new module repository with tests. Safe error whitelist/state/cancel/hidden validation; no stale identity restore.
- [x] HRModules fixed admin UI with own company picker, impact review/reason, tests. Employee banner and cancel permission. Parent owns router/menu integration.
- [x] Review, integration tests, full regression/lint/build/SQL, desktop/mobile preview, docs/local commit. No production apply/deploy.

Ruling: only hr.core is currently available; other planned modules are informative and cannot be activated. Company setting only now; site overrides follow actual site-scoped capabilities. Future dated actions must settle/cancel before read_only/disabled, preventing hidden scheduled changes. User continuation authorizes implementation within existing worktree.
