import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260914000300_bootstrap_first_admin.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const definition = migration.match(/create\s+(?:or\s+replace\s+)?function\s+public\.bootstrap_first_admin\b[\s\S]*?\$\$;/i)?.[0] ?? '';

describe('first-administrator bootstrap migration contract', () => {
    it('serializes the active-admin check and exact profile promotion in one transaction', () => {
        expect(definition).toMatch(/security\s+definer/i);
        expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(definition).toMatch(/pg_catalog\.pg_advisory_xact_lock\s*\(\s*5645584552504144\s*\)/i);
        expect(definition).toMatch(/if\s+exists\s*\([\s\S]*role\s*=\s*'admin'::public\.app_role[\s\S]*is_active\s*=\s*true/i);
        expect(definition).toMatch(/message\s*=\s*'active_admin_exists'/i);
        expect(definition).toMatch(/update\s+public\.profiles[\s\S]*set\s+role\s*=\s*'admin'::public\.app_role[\s\S]*where\s+id\s*=\s*target_user_id/i);
        expect(definition).toMatch(/get\s+diagnostics\s+affected_rows\s*=\s*row_count/i);
        expect(definition).toMatch(/affected_rows\s*<>\s*1[\s\S]*message\s*=\s*'profile_promotion_failed'/i);
    });

    it('allows only the service role to execute the bootstrap RPC', () => {
        expect(migration).toMatch(
            /revoke\s+all\s+on\s+function\s+public\.bootstrap_first_admin\s*\(\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i
        );
        expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.bootstrap_first_admin\s*\(\s*uuid\s*\)\s+to\s+service_role/i);
        expect(migration).not.toMatch(/grant[^;]+bootstrap_first_admin[^;]+to\s+(?:anon|authenticated)/i);
    });
});
