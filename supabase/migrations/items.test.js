import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260915001400_add_items.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';

describe('item master migration contract', () => {
    it('keeps items behind row-level security with no delete grant', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.items\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.items\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.items\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/on\s+public\.items\s+for\s+delete/i);
    });

    it('lets active MFA-verified users read while only administrators write', () => {
        expect(policyDefinition('Active users read items')).toMatch(/for\s+select[\s\S]*private\.is_active_user\s*\(\s*\)/i);
        expect(policyDefinition('Active admins insert items')).toMatch(/for\s+insert[\s\S]*with\s+check\s*\(\s*\(select\s+private\.is_admin\s*\(\s*\)\)\s*\)/i);
        expect(policyDefinition('Active admins update items')).toMatch(/for\s+update[\s\S]*using[\s\S]*private\.is_admin[\s\S]*with\s+check[\s\S]*private\.is_admin/i);
    });

    it('scopes every item to a company and constrains its identifiers and amounts', () => {
        expect(migration).toMatch(/company_id\s+uuid\s+not\s+null\s+references\s+public\.companies\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/constraint\s+items_company_code_key\s+unique\s*\(\s*company_id\s*,\s*code\s*\)/i);
        expect(migration).toMatch(/items_code_format\s+check\s*\(\s*code\s*~\s*'\^\[A-Z0-9\]\[A-Z0-9-\]\{1,19\}\$'\s*\)/i);
        expect(migration).toMatch(/items_unit_format\s+check\s*\(\s*unit\s*~\s*'\^\[A-Z\]\{1,8\}\$'\s*\)/i);
        expect(migration).toMatch(/items_safety_stock_range\s+check\s*\(\s*safety_stock\s*>=\s*0\s*\)/i);
        expect(migration).toMatch(/items_standard_price_range\s+check\s*\(\s*standard_price\s*>=\s*0\s*\)/i);
        expect(migration).toMatch(/create\s+type\s+public\.item_type\s+as\s+enum\s*\(\s*'raw_material'\s*,\s*'semi_finished'\s*,\s*'finished_good'\s*,\s*'consumable'\s*,\s*'service'\s*\)/i);
    });

    it('reuses the shared audit column, active-company and change-ledger triggers', () => {
        expect(migration).toMatch(/create\s+trigger\s+set_items_audit_columns\s+before\s+insert\s+or\s+update\s+on\s+public\.items[\s\S]*?private\.set_master_audit_columns/i);
        expect(migration).toMatch(/create\s+function\s+private\.enforce_item_company_active[\s\S]*?company_inactive[\s\S]*?\$\$;/i);
        expect(migration).toMatch(/create\s+trigger\s+enforce_item_company_active\s+before\s+insert\s+or\s+update\s+on\s+public\.items/i);
        expect(migration).toMatch(/create\s+trigger\s+record_items_audit\s+after\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.items[\s\S]*?private\.record_audit/i);
    });

    it('folds the legacy inventory menu key into the single master ledger key', () => {
        expect(migration).toMatch(/where\s+allowed\.menu_key\s+in\s*\(\s*'inventory\.items'\s*,\s*'master\.items'\s*\)/i);
        expect(migration).toMatch(/pg_catalog\.array_remove\([\s\S]*'inventory\.items'/i);
        expect(migration).toMatch(/pg_catalog\.array_append\s*\(\s*permissions\.allowed_menu_keys\s*,\s*'master\.items'\s*\)/i);
        expect(migration).toMatch(/revision\s*=\s*permissions\.revision\s*\+\s*1/i);
        expect(migration).toMatch(/disable\s+trigger\s+protect_admin_role_menu_permissions[\s\S]*enable\s+trigger\s+protect_admin_role_menu_permissions/i);
    });
});
