import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260914000100_add_companies_and_sites.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';
const functionDefinition = (name) => migration.match(new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+private\\.${name}\\b([\\s\\S]*?)\\$\\$;`, 'i'))?.[0] ?? '';

describe('companies and sites migration contract', () => {
    it.each(['companies', 'sites'])('keeps %s behind row-level security with no delete grant', (table) => {
        expect(migration).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
        expect(migration).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
        expect(migration).toMatch(new RegExp(`grant\\s+select\\s*,\\s*insert\\s*,\\s*update\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, 'i'));
        expect(migration).not.toMatch(new RegExp(`grant\\s+[^;]*(?:delete|all)[^;]*public\\.${table}[^;]*authenticated`, 'i'));
        expect(migration).not.toMatch(new RegExp(`on\\s+public\\.${table}\\s+for\\s+delete`, 'i'));
    });

    it.each(['companies', 'sites'])('lets active MFA-verified users read %s while only administrators write', (table) => {
        expect(policyDefinition(`Active users read ${table}`)).toMatch(/for\s+select[\s\S]*private\.is_active_user\s*\(\s*\)/i);
        expect(policyDefinition(`Active admins insert ${table}`)).toMatch(/for\s+insert[\s\S]*with\s+check\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)/i);
        expect(policyDefinition(`Active admins update ${table}`)).toMatch(/for\s+update[\s\S]*using\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)[\s\S]*with\s+check\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)/i);
    });

    it('defines the active-user helper as a locked-down security-definer function that requires AAL2', () => {
        const definition = functionDefinition('is_active_user');

        expect(definition).toMatch(/security\s+definer/i);
        expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(definition).toMatch(/private\.is_aal2\s*\(\s*\)/i);
        expect(definition).toMatch(/is_active/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+private\.is_active_user\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
    });

    it('stamps audit columns from the caller on both tables', () => {
        const definition = functionDefinition('set_master_audit_columns');

        expect(definition).toMatch(/new\.created_by\s*=\s*\(select\s+auth\.uid\(\)\)/i);
        expect(definition).toMatch(/new\.updated_by\s*=\s*\(select\s+auth\.uid\(\)\)/i);
        expect(definition).toMatch(/new\.created_by\s*=\s*old\.created_by/i);
        expect(migration).toMatch(/create\s+trigger\s+set_companies_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.companies/i);
        expect(migration).toMatch(/create\s+trigger\s+set_sites_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.sites/i);
    });

    it('enforces company and site activity rules in the database', () => {
        expect(functionDefinition('enforce_site_company_active')).toMatch(/company_inactive/);
        expect(migration).toMatch(/create\s+trigger\s+enforce_site_company_active\s+before\s+insert\s+or\s+update\s+on\s+public\.sites/i);
        expect(functionDefinition('deactivate_company_sites')).toMatch(/update\s+public\.sites\s+set\s+is_active\s*=\s*false/i);
        expect(migration).toMatch(/create\s+trigger\s+deactivate_company_sites\s+after\s+update\s+of\s+is_active\s+on\s+public\.companies/i);
    });

    it('constrains identifiers and registration numbers', () => {
        expect(migration).toMatch(/constraint\s+companies_code_key\s+unique\s*\(\s*code\s*\)/i);
        expect(migration).toMatch(/constraint\s+sites_company_code_key\s+unique\s*\(\s*company_id\s*,\s*code\s*\)/i);
        expect(migration).toMatch(/companies_code_format\s+check\s*\(\s*code\s*~\s*'\^\[A-Z0-9\]\[A-Z0-9-\]\{1,19\}\$'\s*\)/i);
        expect(migration).toMatch(/sites_code_format\s+check\s*\(\s*code\s*~\s*'\^\[A-Z0-9\]\[A-Z0-9-\]\{1,19\}\$'\s*\)/i);
        expect(migration).toMatch(/business_number\s+is\s+null\s+or\s+business_number\s*~\s*'\^\[0-9\]\{10\}\$'/i);
        expect(migration).toMatch(/create\s+unique\s+index\s+companies_business_number_key[^;]*where\s+business_number\s+is\s+not\s+null/i);
        expect(migration).toMatch(/create\s+type\s+public\.site_type\s+as\s+enum\s*\(\s*'head_office'\s*,\s*'factory'\s*,\s*'warehouse'\s*,\s*'branch'\s*,\s*'other'\s*\)/i);
        expect(migration).toMatch(/company_id\s+uuid\s+not\s+null\s+references\s+public\.companies\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
    });
});
