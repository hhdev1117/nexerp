# HR Reference and Correction Implementation Plan

> Use superpowers:subagent-driven-development for bounded implementation and independent review.

**Goal:** Company HR reference catalogs, safe employee corrections and audit.
**Architecture:** Migration005 adds catalogs/backfill/validation/audit RPC; separate catalog store; integrated HR forms.
**Tech Stack:** Vue3, PrimeVue, Supabase PostgreSQL, Vitest/PGlite.
**Spec:** ../specs/2026-09-14-hr-reference-design.md

- [x] SQL migration005 and runtime tests first red then green: catalog authorization/backfill, cycles/foreign parent, inactive current/future refs, immutable codes, correction audit/revision/action date boundary. Own supabase new files.
- [x] Client RPC contract/store and tests: strict response validation, no fallback, stale identities, catalog denied writes; add core correctEmployee mutation. Own repository/hr and stores/hr*.
- [x] UI catalog panel + name/date correction/history + assignment dropdowns, mounted behavior tests and responsive preview. Own views/hr.
- [x] Parent review all integration, regression suite, SQL/build/lint, docs/local commit. No production side effects.

Ruling: user authorized next increment after prior summary; continue existing isolated worktree. Current hierarchy with immutable codes maintains compatibility; historical org versions and account reassignment remain subsequent work. Only name/hireDate are correctable; assignment changes use immutable actions.

Review resolutions: exact catalog edit payload excludes companyId, preserve immutable legacy whitespace codes, keep inactive historical parent selections, and refresh access without awaiting history after corrections. Mobile table uses internal scrolling; correction times display Seoul local time. Vitest745, reference PostgreSQL27 and ledger43 assertions; lint/build and1440/375 compiled previews verified. No remaining review blocker. Worktree retained and production untouched.
