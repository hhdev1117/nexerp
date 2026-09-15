# Enterprise Access Activation Implementation Plan

> Use superpowers:subagent-driven-development for bounded implementation and independent review.

**Goal:** Publish immutable policy snapshots and use server-derived company access for menu authorization and company/site RLS.
**Architecture:** Published snapshots are independent of saved drafts. AAL2 administrator publishes/reverts with revision checking and reason. Authenticated runtime RPC derives identity and current date server-side; client receives only own grants and companies. Existing unactivated deployments retain legacy behavior.
**Stack:** Vue 3, Supabase PostgreSQL/RLS, Vitest.
**Spec:** ../specs/2026-09-14-enterprise-access-design.md. This extends the staged implementation.

## Contract

- Runtime repository `loadContext(companyId=null)` calls `enterprise_access_context(target_company uuid)` and returns `{mode:'legacy'|'active',companyId:null|string,companies:[{id,name}],menuKeys:string[],revision:number}`. No arbitrary actor argument or full policy in response. When any policy is active, users without a matching membership get active mode with empty grants, not legacy fallback. Company list contains valid memberships, including inactive companies only for explicitly authorized settings recovery; technical admins may list company names for recovery but gain no active business grants automatically.
- `loadPublication(companyId)` calls `enterprise_access_publication(target_company)` and returns `{revision:number,draftRevision:number|null,active:boolean}`.
- `publish(companyId,draftRevision,expectedRevision,reason)` calls `enterprise_publish_access_policy(target_company,draft_revision,expected_revision,change_reason)` and returns publication.
- `revert(companyId,expectedRevision,reason)` calls `enterprise_revert_access_policy(target_company,expected_revision,change_reason)` and restores the previous snapshot. Revert must never silently remove enforcement and reopen legacy access; no previous snapshot means error.
- Menu access for active policy must match `menu` AND `read` for resource; existence of any valid scope suffices for navigation only. RLS verifies concrete row scopes independently. Technical recovery menu keys accounts/menu-permissions/enterprise-access/infrastructure-usage retain admin-only route guard.
- Company/site RLS: if that company has a publication, read/update/create use policy resource `settings.company` and concrete company/site scope. Before any global publication use original rules; after the first publication unactivated companies are denied to ordinary users, with technical administrator legacy recovery retained. System admin company/site metadata read retained only for recovery catalog through dedicated admin RPC, not automatic published business writes. Company creation remains technical admin operation.
- Runtime company date Asia/Seoul; deny precedence; positions > grades, explicit level first; membership/profile active checked each call. Published snapshots ignore later draft edits.

## Tasks

- [x] SQL publication/audit/runtime evaluator/context/RLS and local PostgreSQL verification.
- [x] Runtime client repository/store, auth guard and company picker, identity reset and refresh failure tests.
- [x] Policy publish/revert controls with explicit impact/reason/revision, administrator company catalog recovery.
- [x] Review, full regressions, build, docs and commit. No production apply or remote push.

## Limits

Other ERP business screens remain in-memory demos, so menu guards do not claim backend data security for nonexistent business tables. Future tables must call the server evaluator in their own RLS/RPC. Authoritative HR assignments, field-level permissions and approval state checks are separate subsequent work.
