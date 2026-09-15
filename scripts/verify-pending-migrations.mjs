// Confirms from PostgreSQL catalogs that the pending migrations were applied to the linked
// Supabase project. Read-only: it uses the repository's read-scoped SUPABASE_MANAGEMENT_TOKEN
// and cannot change anything. Run it after an authorized operator applies the SQL.
//
//   node scripts/verify-pending-migrations.mjs

import { readFileSync } from 'node:fs';

const PROJECT_REF = 'mehhrnbaiojivesnobpv';

const readToken = () => {
    let raw;
    try {
        raw = readFileSync('.dev.vars', 'utf8');
    } catch {
        throw new Error('.dev.vars not found. Copy .dev.vars.example and fill in the project credentials.');
    }
    for (const line of raw.split(/\r?\n/)) {
        const index = line.indexOf('=');
        if (index > 0 && line.slice(0, index).trim() === 'SUPABASE_MANAGEMENT_TOKEN') return line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    }
    throw new Error('SUPABASE_MANAGEMENT_TOKEN missing from .dev.vars.');
};

const token = readToken();

const query = async (sql) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
};

const checks = await query(`select
  to_regclass('public.audit_logs') is not null as audit_logs_exists,
  to_regclass('public.document_sequences') is not null as document_sequences_exists,
  to_regclass('public.items') is not null as items_exists,
  to_regclass('public.warehouses') is not null as warehouses_exists,
  to_regclass('public.accounts') is not null as accounts_exists,
  coalesce((select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.audit_logs')), false) as audit_logs_rls,
  coalesce((select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.document_sequences')), false) as document_sequences_rls,
  coalesce((select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.items')), false) as items_rls,
  coalesce((select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.warehouses')), false) as warehouses_rls,
  coalesce((select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.accounts')), false) as accounts_rls,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='audit_logs' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')) as audit_write_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='document_sequences' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')) as sequence_write_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='items' and grantee='authenticated' and privilege_type = 'DELETE') as item_delete_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='warehouses' and grantee='authenticated' and privilege_type = 'DELETE') as warehouse_delete_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='accounts' and grantee='authenticated' and privilege_type = 'DELETE') as account_delete_grants,
  (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='audit_logs') as audit_policies,
  (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='document_sequences') as sequence_policies,
  (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='items') as item_policies,
  (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='warehouses') as warehouse_policies,
  (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='accounts') as account_policies,
  (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid=t.tgfoid where p.proname='record_audit' and not t.tgisinternal) as audit_triggers,
  exists (select 1 from pg_catalog.pg_proc where proname='record_audit' and pronamespace='private'::regnamespace) as record_audit_exists,
  exists (select 1 from pg_catalog.pg_proc where proname='next_document_number' and pronamespace='private'::regnamespace) as next_number_exists,
  exists (select 1 from pg_catalog.pg_proc where proname='enforce_warehouse_site' and pronamespace='private'::regnamespace) as warehouse_guard_exists,
  (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid=t.tgfoid where p.proname='deactivate_site_warehouses' and not t.tgisinternal) as warehouse_cascade_triggers,
  exists (select 1 from pg_catalog.pg_proc where proname='enforce_account_parent' and pronamespace='private'::regnamespace) as account_guard_exists,
  (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid=t.tgfoid where p.proname='deactivate_account_children' and not t.tgisinternal) as account_cascade_triggers,
  coalesce((select has_function_privilege('authenticated', oid, 'EXECUTE') from pg_catalog.pg_proc where proname='next_document_number' and pronamespace='private'::regnamespace limit 1), false) as authenticated_can_issue,
  (select count(*) from public.role_menu_permissions where 'inventory.items' = any (allowed_menu_keys)) as legacy_item_menu_keys`);

const expected = {
    audit_logs_exists: true,
    document_sequences_exists: true,
    items_exists: true,
    warehouses_exists: true,
    accounts_exists: true,
    audit_logs_rls: true,
    document_sequences_rls: true,
    items_rls: true,
    warehouses_rls: true,
    accounts_rls: true,
    audit_write_grants: 0,
    sequence_write_grants: 0,
    item_delete_grants: 0,
    warehouse_delete_grants: 0,
    account_delete_grants: 0,
    audit_policies: 1,
    sequence_policies: 1,
    item_policies: 3,
    warehouse_policies: 3,
    account_policies: 3,
    audit_triggers: 6,
    record_audit_exists: true,
    next_number_exists: true,
    warehouse_guard_exists: true,
    warehouse_cascade_triggers: 1,
    account_guard_exists: true,
    account_cascade_triggers: 1,
    authenticated_can_issue: false,
    legacy_item_menu_keys: 0
};

const actual = checks[0];
let failed = 0;
for (const [key, want] of Object.entries(expected)) {
    const got = typeof actual[key] === 'string' ? Number(actual[key]) : actual[key];
    const passed = got === want;
    if (!passed) failed += 1;
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${key}: ${got}${passed ? '' : ` (expected ${want})`}`);
}

console.log(failed ? `\n${failed} check(s) failed. The pending migrations are not fully applied.` : '\nAll catalog checks passed.');
process.exitCode = failed ? 1 : 0;
