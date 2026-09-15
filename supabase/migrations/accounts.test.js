import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260916001600_add_accounts.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';
const functionDefinition = (name) => migration.match(new RegExp(`create\\s+function\\s+private\\.${name}\\b([\\s\\S]*?)\\$\\$;`, 'i'))?.[0] ?? '';

describe('chart of accounts migration contract', () => {
    it('keeps accounts behind row-level security with no delete grant', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.accounts\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.accounts\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.accounts\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/on\s+public\.accounts\s+for\s+delete/i);
        expect(policyDefinition('Active users read accounts')).toMatch(/for\s+select[\s\S]*private\.is_active_user/i);
        expect(policyDefinition('Active admins update accounts')).toMatch(/for\s+update[\s\S]*private\.is_admin[\s\S]*private\.is_admin/i);
    });

    it('uses numeric codes and a self-referencing hierarchy', () => {
        expect(migration).toMatch(/accounts_code_format\s+check\s*\(\s*code\s*~\s*'\^\[0-9\]\{3,10\}\$'\s*\)/i);
        expect(migration).toMatch(/constraint\s+accounts_company_code_key\s+unique\s*\(\s*company_id\s*,\s*code\s*\)/i);
        expect(migration).toMatch(/parent_id\s+uuid\s+null\s+references\s+public\.accounts\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/is_postable\s+boolean\s+not\s+null\s+default\s+true/i);
        expect(migration).toMatch(/create\s+type\s+public\.account_type\s+as\s+enum\s*\(\s*'asset'\s*,\s*'liability'\s*,\s*'equity'\s*,\s*'revenue'\s*,\s*'expense'\s*\)/i);
    });

    it('refuses every unusable parent relationship with a stable reason', () => {
        const guard = functionDefinition('enforce_account_parent');

        expect(guard).toMatch(/security\s+definer/i);
        for (const reason of ['company_inactive', 'invalid_parent', 'parent_not_found', 'parent_company_mismatch', 'parent_type_mismatch', 'parent_is_postable', 'parent_inactive']) {
            expect(guard).toContain(reason);
        }
        expect(guard).toMatch(/with\s+recursive\s+chain\s+as/i);
        expect(migration).toMatch(/create\s+trigger\s+enforce_account_parent\s+before\s+insert\s+or\s+update\s+on\s+public\.accounts/i);
    });

    it('deactivates every descendant when a summary account is deactivated', () => {
        const cascade = functionDefinition('deactivate_account_children');

        expect(cascade).toMatch(/with\s+recursive\s+descendants\s+as/i);
        expect(cascade).toMatch(/update\s+public\.accounts\s+set\s+is_active\s*=\s*false/i);
        expect(migration).toMatch(/create\s+trigger\s+deactivate_account_children\s+after\s+update\s+of\s+is_active\s+on\s+public\.accounts/i);
    });

    it('reuses the shared audit column and change-ledger triggers', () => {
        expect(migration).toMatch(/create\s+trigger\s+set_accounts_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.accounts[\s\S]*?private\.set_master_audit_columns/i);
        expect(migration).toMatch(/create\s+trigger\s+record_accounts_audit\s+after\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.accounts[\s\S]*?private\.record_audit/i);
    });
});
