import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260913000100_add_admin_profile_status_update.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const functionDefinition = () => {
    const match = migration.match(/create\s+function\s+public\.admin_update_profile_status\b([\s\S]*?)\$\$;/i);
    return match?.[0] ?? '';
};

describe('administrator profile status migration contract', () => {
    it('keeps status-only writes behind the administrator RPC and self-lock guard', () => {
        const definition = functionDefinition();

        expect(definition).toMatch(/security\s+definer/i);
        expect(definition).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(definition).toMatch(/private\.is_admin\s*\(\s*\)/i);
        expect(definition).toMatch(/target_id\s*=\s*caller_id\s+and\s+not\s+new_is_active/i);
        expect(definition).toMatch(/message\s*=\s*'self_deactivation_forbidden'/i);
        expect(definition).toMatch(/set\s+is_active\s*=\s*new_is_active/i);
        expect(definition).not.toMatch(/set[\s\S]*display_name\s*=/i);
        expect(definition).not.toMatch(/set[\s\S]*department\s*=/i);
        expect(definition).not.toMatch(/set[\s\S]*role\s*=/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+public\.admin_update_profile_status[^;]*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.admin_update_profile_status[^;]*to\s+authenticated/i);
    });
});
