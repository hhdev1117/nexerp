import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260916001500_add_warehouses.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';
const functionDefinition = (name) => migration.match(new RegExp(`create\\s+function\\s+private\\.${name}\\b([\\s\\S]*?)\\$\\$;`, 'i'))?.[0] ?? '';

describe('warehouse master migration contract', () => {
    it('keeps warehouses behind row-level security with no delete grant', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.warehouses\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.warehouses\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.warehouses\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/on\s+public\.warehouses\s+for\s+delete/i);
    });

    it('lets active MFA-verified users read while only administrators write', () => {
        expect(policyDefinition('Active users read warehouses')).toMatch(/for\s+select[\s\S]*private\.is_active_user\s*\(\s*\)/i);
        expect(policyDefinition('Active admins insert warehouses')).toMatch(/for\s+insert[\s\S]*with\s+check[\s\S]*private\.is_admin/i);
        expect(policyDefinition('Active admins update warehouses')).toMatch(/for\s+update[\s\S]*using[\s\S]*private\.is_admin[\s\S]*with\s+check[\s\S]*private\.is_admin/i);
    });

    it('anchors a warehouse to both a company and one of that company sites', () => {
        expect(migration).toMatch(/company_id\s+uuid\s+not\s+null\s+references\s+public\.companies\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/site_id\s+uuid\s+not\s+null\s+references\s+public\.sites\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/constraint\s+warehouses_company_code_key\s+unique\s*\(\s*company_id\s*,\s*code\s*\)/i);
        expect(migration).toMatch(/create\s+type\s+public\.warehouse_type\s+as\s+enum\s*\(\s*'raw_material'\s*,\s*'finished_good'\s*,\s*'packaging'\s*,\s*'general'\s*\)/i);

        const guard = functionDefinition('enforce_warehouse_site');
        expect(guard).toMatch(/security\s+definer/i);
        expect(guard).toMatch(/site_not_found/);
        expect(guard).toMatch(/site_company_mismatch/);
        expect(guard).toMatch(/site_inactive/);
        expect(migration).toMatch(/create\s+trigger\s+enforce_warehouse_site\s+before\s+insert\s+or\s+update\s+on\s+public\.warehouses/i);
    });

    it('cascades a site deactivation to the warehouses inside it', () => {
        expect(functionDefinition('deactivate_site_warehouses')).toMatch(/update\s+public\.warehouses\s+set\s+is_active\s*=\s*false/i);
        expect(migration).toMatch(/create\s+trigger\s+deactivate_site_warehouses\s+after\s+update\s+of\s+is_active\s+on\s+public\.sites/i);
    });

    it('reuses the shared audit column and change-ledger triggers', () => {
        expect(migration).toMatch(/create\s+trigger\s+set_warehouses_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.warehouses[\s\S]*?private\.set_master_audit_columns/i);
        expect(migration).toMatch(/create\s+trigger\s+record_warehouses_audit\s+after\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.warehouses[\s\S]*?private\.record_audit/i);
    });
});
