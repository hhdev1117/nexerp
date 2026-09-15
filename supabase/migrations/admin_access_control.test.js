import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260912000100_add_admin_access_control.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const functionDefinition = (name) => {
    const match = migration.match(new RegExp(`create\\s+function\\s+public\\.${name}\\b([\\s\\S]*?)\\$\\$;`, 'i'));
    return match?.[0] ?? '';
};

describe('administrator access-control migration contract', () => {
    it('keeps menu writes behind RLS and authenticated RPCs', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.role_menu_permissions\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.role_menu_permissions\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s+on\s+table\s+public\.role_menu_permissions\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+(?:insert|update|delete|all)[^;]*role_menu_permissions[^;]*authenticated/i);
    });

    it('does not expose profile role or activation columns for direct updates', () => {
        expect(migration).toMatch(/revoke\s+update\s*\(\s*role\s*,\s*is_active\s*\)\s+on\s+table\s+public\.profiles\s+from\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+update\s*\([^)]*(?:role|is_active)[^)]*\)[^;]*authenticated/i);
    });

    it.each(['admin_replace_role_menu_permissions', 'admin_update_profile'])('%s is a locked-down security-definer RPC', (name) => {
        const definition = functionDefinition(name);

        expect(definition).toMatch(/security\s+definer/i);
        expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(definition).toMatch(/private\.is_admin\s*\(\s*\)/i);
        expect(migration).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[^;]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
        expect(migration).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*to\\s+authenticated`, 'i'));
    });

    it('protects the administrator permission row from mutation', () => {
        expect(migration).toMatch(/create\s+trigger\s+protect_admin_role_menu_permissions/i);
        expect(migration).toMatch(/before\s+update\s+or\s+delete\s+on\s+public\.role_menu_permissions/i);
        expect(migration).toMatch(/admin_role_permissions_immutable/i);
    });
});
