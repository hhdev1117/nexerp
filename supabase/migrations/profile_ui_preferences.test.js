import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationVersion = '20260916001700';
const migrationName = `${migrationVersion}_add_profile_ui_preferences.sql`;
const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationPath = resolve(migrationsDirectory, migrationName);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('profile UI preferences migration contract', () => {
    it('uses the unique next migration version', () => {
        const filesAtVersion = readdirSync(migrationsDirectory).filter((name) => name.startsWith(`${migrationVersion}_`) && name.endsWith('.sql'));

        expect(filesAtVersion).toEqual([migrationName]);
    });

    it('adds non-null JSON preferences with an empty-object default', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.profiles[\s\S]*add\s+column\s+ui_preferences\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);
    });

    it('accepts only JSON objects', () => {
        expect(migration).toMatch(/constraint\s+profiles_ui_preferences_object\s+check\s*\(\s*jsonb_typeof\s*\(\s*ui_preferences\s*\)\s*=\s*'object'\s*\)/i);
    });

    it('grants authenticated users only the new update column', () => {
        expect(migration).toMatch(/grant\s+update\s*\(\s*ui_preferences\s*\)\s+on\s+table\s+public\.profiles\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+update\s+on\s+table\s+public\.profiles/i);
        expect(migration).not.toMatch(/grant\s+[^;]*(?:delete|all)[^;]*public\.profiles[^;]*authenticated/i);
    });

    it('preserves existing profile grants and reuses the existing self-update policy', () => {
        expect(migration).not.toBe('');
        expect(migration).not.toMatch(/\brevoke\b/i);
        expect(migration).not.toMatch(/create\s+policy/i);
    });
});
