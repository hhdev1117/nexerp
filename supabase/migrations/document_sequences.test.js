import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260915001300_add_document_sequences.sql');
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const issueNumber = migration.match(/create\s+function\s+private\.next_document_number\b([\s\S]*?)\$\$;/i)?.[0] ?? '';

describe('document numbering migration contract', () => {
    it('keeps counters behind row-level security with no client write path', () => {
        expect(migration).toMatch(/alter\s+table\s+public\.document_sequences\s+enable\s+row\s+level\s+security/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+table\s+public\.document_sequences\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
        expect(migration).toMatch(/grant\s+select\s+on\s+table\s+public\.document_sequences\s+to\s+authenticated/i);
        expect(migration).not.toMatch(/grant\s+[^;]*(?:insert|update|delete|all)[^;]*public\.document_sequences[^;]*authenticated/i);
        expect(migration).toMatch(/create\s+policy\s+"Administrators read document sequences"[\s\S]*for\s+select[\s\S]*private\.is_admin\s*\(\s*\)/i);
    });

    it('keys one counter per company, document type and period', () => {
        expect(migration).toMatch(/company_id\s+uuid\s+not\s+null\s+references\s+public\.companies\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
        expect(migration).toMatch(/constraint\s+document_sequences_pkey\s+primary\s+key\s*\(\s*company_id\s*,\s*doc_type\s*,\s*period_key\s*\)/i);
        expect(migration).toMatch(/document_sequences_doc_type_format\s+check\s*\(\s*doc_type\s*~\s*'\^\[A-Z\]\{2,4\}\$'\s*\)/i);
        expect(migration).toMatch(/document_sequences_period_key_format\s+check\s*\(\s*period_key\s*~\s*'\^\[0-9\]\{6\}\$'\s*\)/i);
    });

    it('claims the next number atomically instead of counting existing rows', () => {
        expect(issueNumber).toMatch(/security\s+definer/i);
        expect(issueNumber).toMatch(/set\s+search_path\s*=\s*''/i);
        expect(issueNumber).toMatch(/insert\s+into\s+public\.document_sequences[\s\S]*on\s+conflict\s+on\s+constraint\s+document_sequences_pkey[\s\S]*do\s+update\s+set\s+last_number\s*=\s*sequences\.last_number\s*\+\s*1[\s\S]*returning\s+sequences\.last_number/i);
        expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+private\.next_document_number\s*\(\s*uuid\s*,\s*text\s*,\s*date\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
    });

    it('formats numbers as TYPE-YYMMDD-NNN in the Korean business day', () => {
        expect(issueNumber).toMatch(/pg_catalog\.to_char\s*\(\s*issue_date\s*,\s*'YYMMDD'\s*\)/i);
        expect(issueNumber).toMatch(/pg_catalog\.now\(\)\s+at\s+time\s+zone\s+'Asia\/Seoul'/i);
        expect(issueNumber).toMatch(/case\s+when\s+next_number\s*>\s*999\s+then\s+next_number::text\s+else\s+pg_catalog\.lpad\s*\(\s*next_number::text\s*,\s*3\s*,\s*'0'\s*\)\s+end/i);
    });

    it('refuses unusable callers with stable business codes', () => {
        for (const reason of ['company_required', 'invalid_document_type', 'company_inactive']) {
            expect(issueNumber).toMatch(new RegExp(`errcode\\s*=\\s*'22023'\\s*,\\s*message\\s*=\\s*'${reason}'`, 'i'));
        }
    });
});
