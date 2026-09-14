import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260914000200_add_login_ids.sql');
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('login ID migration contract', () => {
    it('stores unique, format-constrained login IDs and provisions matching internal identities', () => {
        expect(sql).toContain('add column login_id text');
        expect(sql).toContain("login_id ~ '^[a-z0-9]{4,20}$'");
        expect(sql).toContain('create unique index profiles_login_id_key');
        expect(sql).toContain("new.raw_app_meta_data ->> 'login_id'");
        expect(sql).toContain("normalized_login_id || '@nexerp.internal'");
    });
});
