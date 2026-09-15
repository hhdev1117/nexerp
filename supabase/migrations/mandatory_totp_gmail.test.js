import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260913000300_enforce_totp_and_gmail_provisioning.sql');
const loginIdentityMigrationPath = resolve(process.cwd(), 'supabase/migrations/20260915000100_add_login_ids.sql');
const configPath = resolve(process.cwd(), 'supabase/config.toml');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const loginIdentityMigration = existsSync(loginIdentityMigrationPath) ? readFileSync(loginIdentityMigrationPath, 'utf8') : '';
const config = readFileSync(configPath, 'utf8');
const hasProvisioningMarker = (metadata) => metadata?.nexerp_provisioned === true;

const functionDefinition = (source, name) => {
    const match = source.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+private\\.${name}\\s*\\(\\s*\\)([\\s\\S]*?)\\$\\$;`, 'i'));
    return match?.[0] ?? '';
};

describe('mandatory TOTP and Gmail migration contract', () => {
    it('defines an AAL2 helper and makes administrator authorization depend on it', () => {
        const isAal2 = functionDefinition(migration, 'is_aal2');
        const isAdmin = functionDefinition(migration, 'is_admin');

        expect(isAal2).toMatch(/returns\s+boolean/i);
        expect(isAal2).toMatch(/stable/i);
        expect(isAal2).toMatch(/security\s+definer/i);
        expect(isAal2).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(isAal2).toMatch(/auth\.jwt\s*\(\s*\)\s*->>\s*'aal'\s*\)??\s*=\s*'aal2'/i);
        expect(isAdmin).toMatch(/private\.is_aal2\s*\(\s*\)/i);
        expect(isAdmin).toMatch(/role\s*=\s*'admin'/i);
        expect(isAdmin).toMatch(/and\s+is_active/i);
        for (const name of ['is_aal2', 'is_admin']) {
            expect(migration).toMatch(new RegExp(`alter\\s+function\\s+private\\.${name}\\s*\\(\\s*\\)\\s+owner\\s+to\\s+postgres`, 'i'));
            expect(migration).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+private\\.${name}\\s*\\(\\s*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
            expect(migration).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+private\\.${name}\\s*\\(\\s*\\)\\s+to\\s+authenticated`, 'i'));
        }
    });

    it('requires AAL2 for both role-menu read paths', () => {
        expect(migration).toMatch(/drop\s+policy\s+if\s+exists\s+"Active users read their role menu permissions"\s+on\s+public\.role_menu_permissions/i);
        expect(migration).toMatch(/drop\s+policy\s+if\s+exists\s+"Active admins read all role menu permissions"\s+on\s+public\.role_menu_permissions/i);
        const policies = migration.match(/create\s+policy[\s\S]*?;(?=\s*create\s+policy|\s*$)/gi)?.join('\n') ?? '';
        expect(policies).toMatch(/Active users read their role menu permissions[\s\S]*private\.is_aal2\s*\(\s*\)/i);
        expect(policies).toMatch(/Active admins read all role menu permissions[\s\S]*private\.is_aal2\s*\(\s*\)/i);
    });

    it('replaces the Gmail signup policy with login identity and boolean provisioning guards', () => {
        const handler = functionDefinition(loginIdentityMigration, 'handle_new_user');

        expect(handler).toMatch(/pg_catalog\.lower\s*\(\s*coalesce\s*\(\s*new\.email\s*,\s*''\s*\)\s*\)/i);
        expect(handler).toMatch(/new\.raw_app_meta_data\s*->>\s*'login_id'/i);
        expect(handler).toMatch(/\^\[a-z0-9\]\{4,20\}\$/i);
        expect(handler).toMatch(/normalized_login_id\s*\|\|\s*'@nexerp\.internal'/i);
        expect(handler).toMatch(/new\.raw_app_meta_data\s*@>\s*'\{"nexerp_provisioned":\s*true\}'::jsonb/i);
        expect(handler).toMatch(/message\s*=\s*'invalid_login_id'/i);
        expect(handler).toMatch(/message\s*=\s*'login_identity_mismatch'/i);
        expect(handler).toMatch(/message\s*=\s*'provisioning_required'/i);
        expect(handler).toMatch(/values\s*\(\s*new\.id\s*,\s*expected_email\s*,\s*normalized_login_id/i);
        expect(handler).toMatch(/security\s+definer/i);
        expect(handler).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(loginIdentityMigration).toMatch(/alter\s+function\s+private\.handle_new_user\s*\(\s*\)\s+owner\s+to\s+postgres/i);
        expect(loginIdentityMigration).toMatch(/revoke\s+all\s+on\s+function\s+private\.handle_new_user\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
    });

    it('accepts only a JSON boolean provisioning marker', () => {
        expect(hasProvisioningMarker({ nexerp_provisioned: true })).toBe(true);
        expect(hasProvisioningMarker({ nexerp_provisioned: 'true' })).toBe(false);
        expect(hasProvisioningMarker({ nexerp_provisioned: 1 })).toBe(false);
        expect(hasProvisioningMarker({})).toBe(false);
        expect(hasProvisioningMarker({ user_metadata: { nexerp_provisioned: true } })).toBe(false);
    });

    it('explicitly disables signup and enables local TOTP enrollment and verification', () => {
        expect(config).toMatch(/\[auth\][\s\S]*?enable_signup\s*=\s*false/i);
        expect(config).toMatch(/\[auth\.email\][\s\S]*?enable_signup\s*=\s*false/i);
        expect(config).toMatch(/\[auth\.mfa\.totp\][\s\S]*?enroll_enabled\s*=\s*true[\s\S]*?verify_enabled\s*=\s*true/i);
    });
});
