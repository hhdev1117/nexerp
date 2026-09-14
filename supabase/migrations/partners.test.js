import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260914000200_add_partners.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const pgTapPath = resolve(process.cwd(), 'supabase/tests/partners_rls.test.sql');
const pgTap = existsSync(pgTapPath) ? readFileSync(pgTapPath, 'utf8') : '';

const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';
const functionDefinition = (name) => migration.match(new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+private\\.${name}\\b([\\s\\S]*?)\\$\\$;`, 'i'))?.[0] ?? '';

describe('partners migration contract', () => {
    it('creates the company-scoped partner master with the specified fields and audit defaults', () => {
        expect(migration).toMatch(/create\s+table\s+public\.partners\s*\(/i);
        expect(migration).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\s*\(\s*\)/i);
        expect(migration).toMatch(/company_id\s+uuid\s+not\s+null\s+references\s+public\.companies\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/code\s+text\s+not\s+null/i);
        expect(migration).toMatch(/name\s+text\s+not\s+null/i);
        expect(migration).toMatch(/business_number\s+text\s+null/i);
        expect(migration).toMatch(/is_customer\s+boolean\s+not\s+null\s+default\s+false/i);
        expect(migration).toMatch(/is_vendor\s+boolean\s+not\s+null\s+default\s+false/i);
        expect(migration).toMatch(/representative\s+text\s+not\s+null\s+default\s+''/i);
        expect(migration).toMatch(/email\s+text\s+not\s+null\s+default\s+''/i);
        expect(migration).toMatch(/phone\s+text\s+not\s+null\s+default\s+''/i);
        expect(migration).toMatch(/address\s+text\s+not\s+null\s+default\s+''/i);
        expect(migration).toMatch(/is_active\s+boolean\s+not\s+null\s+default\s+true/i);
        expect(migration).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i);
        expect(migration).toMatch(/updated_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i);
        expect(migration).toMatch(/created_by\s+uuid\s+null/i);
        expect(migration).toMatch(/updated_by\s+uuid\s+null/i);
    });

    it('enforces company-scoped uniqueness and partner validation', () => {
        expect(migration).toMatch(/constraint\s+partners_company_code_key\s+unique\s*\(\s*company_id\s*,\s*code\s*\)/i);
        expect(migration).toMatch(/create\s+unique\s+index\s+partners_company_business_number_key\s+on\s+public\.partners\s*\(\s*company_id\s*,\s*business_number\s*\)\s+where\s+business_number\s+is\s+not\s+null/i);
        expect(migration).toMatch(/create\s+index\s+partners_company_id_idx\s+on\s+public\.partners\s*\(\s*company_id\s*\)/i);
        expect(migration).toMatch(/partners_code_format\s+check\s*\(\s*code\s*~\s*'\^\[A-Z0-9\]\[A-Z0-9-\]\{1,19\}\$'\s*\)/i);
        expect(migration).toMatch(/partners_name_not_blank\s+check\s*\(\s*btrim\s*\(\s*name\s*\)\s*<>\s*''\s*\)/i);
        expect(migration).toMatch(/partners_role_required\s+check\s*\(\s*is_customer\s+or\s+is_vendor\s*\)/i);
        expect(migration).toMatch(/partners_business_number_format\s+check\s*\(\s*business_number\s+is\s+null\s+or\s+business_number\s*~\s*'\^\[0-9\]\{10\}\$'\s*\)/i);
    });

    it('enables RLS and grants authenticated read and write without physical deletion', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.partners\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.partners\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.partners\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+[^;]*(?:delete|all)[^;]*public\.partners[^;]*authenticated/i);
        expect(migration).not.toMatch(/on\s+public\.partners\s+for\s+delete/i);
    });

    it('lets active MFA-verified users read while only administrators write', () => {
        expect(policyDefinition('Active users read partners')).toMatch(/for\s+select[\s\S]*private\.is_active_user\s*\(\s*\)/i);
        expect(policyDefinition('Active admins insert partners')).toMatch(/for\s+insert[\s\S]*with\s+check\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)/i);
        expect(policyDefinition('Active admins update partners')).toMatch(/for\s+update[\s\S]*using\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)[\s\S]*with\s+check\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)/i);
    });

    it('reuses the audit trigger and enforces active-company ownership in a locked-down function', () => {
        expect(migration).toMatch(/create\s+trigger\s+set_partners_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.partners[\s\S]*execute\s+function\s+private\.set_master_audit_columns\s*\(\s*\)/i);

        const definition = functionDefinition('enforce_partner_company_active');
        expect(definition).toMatch(/security\s+definer/i);
        expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(definition).toMatch(/new\.is_active/i);
        expect(definition).toMatch(/from\s+public\.companies[\s\S]*id\s*=\s*new\.company_id[\s\S]*is_active/i);
        expect(definition).toMatch(/company_inactive/i);
        expect(migration).toMatch(/revoke\s+execute\s+on\s+function\s+private\.enforce_partner_company_active\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/create\s+trigger\s+enforce_partner_company_active\s+before\s+insert\s+or\s+update\s+on\s+public\.partners[\s\S]*execute\s+function\s+private\.enforce_partner_company_active\s*\(\s*\)/i);
    });

    it('unions legacy grants into master.partners before removing legacy keys', () => {
        const insertAt = migration.search(/insert\s+into\s+partner_permission_grants/i);
        const cleanupAt = migration.search(/array_remove\s*\([\s\S]*?'sales\.customers'[\s\S]*?'purchasing\.vendors'/i);

        expect(insertAt).toBeGreaterThanOrEqual(0);
        expect(cleanupAt).toBeGreaterThan(insertAt);
        expect(migration).toMatch(/insert\s+into\s+partner_permission_grants\s*\(\s*role\s*,\s*menu_key\s*\)\s+select\s+distinct\s+permissions\.role\s*,\s*'master\.partners'/i);
        expect(migration).toMatch(/unnest\s*\(\s*permissions\.allowed_menu_keys\s*\)[\s\S]*in\s*\(\s*'sales\.customers'\s*,\s*'purchasing\.vendors'\s*,\s*'master\.partners'\s*\)/i);
        expect(migration).toMatch(/on\s+conflict\s+do\s+nothing/i);
        expect(migration).toMatch(/array_append[\s\S]*allowed_menu_keys[\s\S]*'master\.partners'/i);
        expect(migration).toMatch(/(?:pg_catalog\.)?array_remove\s*\(\s*(?:pg_catalog\.)?array_remove\s*\([\s\S]*?'sales\.customers'[\s\S]*?'purchasing\.vendors'/i);
        expect(migration).not.toMatch(/delete\s+from\s+public\.role_menu_permissions[\s\S]*master\.partners/i);
    });

    it('defines the complete 35-assertion pgTAP security contract', () => {
        const assertions = pgTap.match(/^select\s+(?:ok|results_eq|is_empty|throws_ok|lives_ok)\s*\(/gim) ?? [];

        expect(pgTap).toMatch(/select\s+plan\s*\(\s*35\s*\)/i);
        expect(assertions).toHaveLength(35);
        expect(pgTap).toMatch(/row-level security enabled/i);
        expect(pgTap).toMatch(/AAL1 user cannot read partners/i);
        expect(pgTap).toMatch(/active AAL2 user reads partners/i);
        expect(pgTap).toMatch(/ordinary user cannot insert partners/i);
        expect(pgTap).toMatch(/AAL2 administrator inserts a partner/i);
        expect(pgTap).toMatch(/audit columns record the caller/i);
        expect(pgTap).toMatch(/partner codes are unique within a company/i);
        expect(pgTap).toMatch(/business numbers are unique within a company/i);
        expect(pgTap).toMatch(/partner must be a customer, a vendor, or both/i);
        expect(pgTap).toMatch(/active partner cannot be created under an inactive company/i);
        expect(pgTap).toMatch(/sales\.customers is removed/i);
        expect(pgTap).toMatch(/purchasing\.vendors is removed/i);
    });
});
