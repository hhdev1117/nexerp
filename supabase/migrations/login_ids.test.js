import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260915000100_add_login_ids.sql');
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const existingRlsFixturePaths = [
    'supabase/tests/profiles_rls.test.sql',
    'supabase/tests/admin_access_control_rls.test.sql',
    'supabase/tests/companies_sites_rls.test.sql'
];
const existingRlsFixtures = existingRlsFixturePaths.map((path) => [path, readFileSync(resolve(process.cwd(), path), 'utf8')]);

describe('login ID migration contract', () => {
    it('stores unique, format-constrained login IDs and provisions matching internal identities', () => {
        expect(sql).toContain('add column login_id text');
        expect(sql).toContain("login_id ~ '^[a-z0-9]{4,20}$'");
        expect(sql).toContain('create unique index profiles_login_id_key');
        expect(sql).toContain("new.raw_app_meta_data ->> 'login_id'");
        expect(sql).toContain("normalized_login_id || '@nexerp.internal'");
    });

    it('makes the profile login ID mandatory', () => {
        expect(sql).toMatch(/alter table public\.profiles alter column login_id set not null/i);
    });

    it.each(existingRlsFixtures)('%s provisions users through the login identity contract', (_path, fixture) => {
        expect(fixture).not.toMatch(/@gmail[.]com/i);
        expect(fixture).toMatch(/@nexerp[.]internal/i);
        expect(fixture).toMatch(/"login_id"\s*:/i);
    });
});
