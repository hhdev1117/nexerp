import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260915001200_add_audit_logs.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

const policyDefinition = (name) => migration.match(new RegExp(`create\\s+policy\\s+"${name}"([\\s\\S]*?);`, 'i'))?.[0] ?? '';
const recordAudit = migration.match(/create\s+function\s+private\.record_audit\b([\s\S]*?)\$\$;/i)?.[0] ?? '';

describe('audit log migration contract', () => {
    it('keeps the ledger behind row-level security with a read-only grant', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.audit_logs\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.audit_logs\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s+on\s+table\s+public\.audit_logs\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+[^;]*(?:insert|update|delete|all)[^;]*public\.audit_logs[^;]*authenticated/i);
    });

    it('lets only administrators read history and defines no write policy', () => {
        expect(policyDefinition('Administrators read audit logs')).toMatch(/for\s+select[\s\S]*private\.is_admin\s*\(\s*\)/i);
        expect(migration).not.toMatch(/on\s+public\.audit_logs\s+for\s+(?:insert|update|delete)/i);
    });

    it('records the caller, the action and both value snapshots', () => {
        expect(recordAudit).toMatch(/security\s+definer/i);
        expect(recordAudit).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(recordAudit).toMatch(/previous\s*:=\s*pg_catalog\.to_jsonb\s*\(\s*old\s*\)/i);
        expect(recordAudit).toMatch(/latest\s*:=\s*pg_catalog\.to_jsonb\s*\(\s*new\s*\)/i);
        expect(recordAudit).toMatch(/actor_id[\s\S]*\(select\s+auth\.uid\(\)\)/i);
        expect(recordAudit).toMatch(/pg_catalog\.lower\s*\(\s*tg_op\s*\)::public\.audit_action/i);
        expect(migration).toMatch(/revoke\s+execute\s+on\s+function\s+private\.record_audit\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
    });

    it('skips updates that change nothing but the audit columns', () => {
        expect(recordAudit).toMatch(/tg_op\s*=\s*'UPDATE'\s+and\s*\(\s*previous\s*-\s*'updated_at'\s*-\s*'updated_by'\s*\)\s+is\s+not\s+distinct\s+from\s*\(\s*latest\s*-\s*'updated_at'\s*-\s*'updated_by'\s*\)/i);
    });

    it('scopes every entry to a company, falling back to the company row itself', () => {
        expect(recordAudit).toMatch(/scope\s*:=\s*nullif\s*\(\s*subject\s*->>\s*'company_id'\s*,\s*''\s*\)::uuid/i);
        expect(recordAudit).toMatch(/tg_table_name\s*=\s*'companies'[\s\S]*subject\s*->>\s*'id'/i);
    });

    it('constrains the payload to match the recorded action', () => {
        expect(migration).toMatch(/create\s+type\s+public\.audit_action\s+as\s+enum\s*\(\s*'insert'\s*,\s*'update'\s*,\s*'delete'\s*\)/i);
        expect(migration).toMatch(/action\s*=\s*'insert'\s+and\s+old_data\s+is\s+null\s+and\s+new_data\s+is\s+not\s+null/i);
        expect(migration).toMatch(/action\s*=\s*'update'\s+and\s+old_data\s+is\s+not\s+null\s+and\s+new_data\s+is\s+not\s+null/i);
        expect(migration).toMatch(/action\s*=\s*'delete'\s+and\s+old_data\s+is\s+not\s+null\s+and\s+new_data\s+is\s+null/i);
    });

    it.each(['companies', 'sites', 'partners'])('attaches the shared trigger to %s', (table) => {
        expect(migration).toMatch(new RegExp(`create\\s+trigger\\s+record_${table}_audit\\s+after\\s+insert\\s+or\\s+update\\s+or\\s+delete\\s+on\\s+public\\.${table}[\\s\\S]*?execute\\s+function\\s+private\\.record_audit\\s*\\(\\s*\\)`, 'i'));
    });

    it('indexes the columns the administrator screen filters on', () => {
        expect(migration).toMatch(/create\s+index\s+audit_logs_changed_at_idx/i);
        expect(migration).toMatch(/create\s+index\s+audit_logs_table_record_idx/i);
        expect(migration).toMatch(/create\s+index\s+audit_logs_actor_idx/i);
        expect(migration).toMatch(/create\s+index\s+audit_logs_company_idx/i);
    });
});
