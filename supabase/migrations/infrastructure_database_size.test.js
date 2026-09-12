import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260913000200_add_infrastructure_database_size.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('infrastructure database size migration contract', () => {
    it('sums all PostgreSQL database sizes as bytes with a fixed SECURITY DEFINER search path', () => {
        expect(migration).toMatch(/create\s+function\s+public\.infrastructure_database_size\s*\(\s*\)/i);
        expect(migration).toMatch(/returns\s+bigint/i);
        expect(migration).toMatch(/security\s+definer/i);
        expect(migration).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(migration).toMatch(/sum\s*\(\s*pg_catalog\.pg_database_size\s*\(\s*database\.datname\s*\)\s*\)/i);
        expect(migration).toMatch(/from\s+pg_catalog\.pg_database\s+as\s+database/i);
        expect(migration).toMatch(/alter\s+function\s+public\.infrastructure_database_size\s*\(\s*\)\s+owner\s+to\s+postgres/i);
    });

    it('allows execution only by the service role', () => {
        expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+public\.infrastructure_database_size\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.infrastructure_database_size\s*\(\s*\)\s+to\s+service_role\s*;/i);
        expect(migration).not.toMatch(/grant\s+execute[^;]*to\s+(public|anon|authenticated)\b/i);
    });
});
