import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const documentationPaths = ['README.md', 'docs/setup/cloudflare-supabase.md', 'docs/setup/fresh-machine.md'];
const operationsPath = 'docs/setup/cloudflare-supabase.md';
const deploymentGuidePaths = [operationsPath, 'docs/setup/fresh-machine.md'];
const requiredCommands = ['npm ci', 'npm test -- --run', 'npm run dev', 'npm run dev:cloudflare', 'npx supabase db push', 'npx wrangler secret put', 'npm run deploy', 'git pull --ff-only origin main'];
const orderedAuthenticationMigrationVersions = ['20260915000100', '20260915000200', '20260915000300'];

const readDocument = (path) => {
    const absolutePath = resolve(process.cwd(), path);
    return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
};

const readDocumentationSet = () => documentationPaths.map(readDocument).join('\n');

describe('setup documentation', () => {
    it.each(requiredCommands)('documents the exact command `%s`', (command) => {
        expect(readDocumentationSet()).toContain(command);
    });

    it('documents credential-safe first-administrator bootstrap and mandatory TOTP enrollment', () => {
        const operations = readDocument(operationsPath);

        expect(operations).toContain('npm run bootstrap:admin');
        expect(operations).toMatch(/Remove-Item Env:\\NEXERP_ADMIN_TEMPORARY_PASSWORD/);
        expect(operations).toMatch(/first login|첫 로그인/i);
        expect(operations).toMatch(/TOTP/);
        expect(operations).not.toMatch(/NEXERP_ADMIN_TEMPORARY_PASSWORD\s*=\s*['"][^<'"\r\n]+['"]/);
    });

    it('documents credential-safe remediation when bootstrap compensation fails', () => {
        const operations = readDocument(operationsPath);

        expect(operations).toContain('promotion_failed_compensation_failed');
        expect(operations).toMatch(/Auth user|Auth 사용자/i);
        expect(operations).toMatch(/user ID|사용자 ID/i);
        expect(operations).toMatch(/delete|삭제/i);
        expect(operations).toMatch(/do not rerun|다시 실행하지/i);
    });

    it.each(deploymentGuidePaths)('builds static assets immediately before the Wrangler dry-run in %s', (path) => {
        expect(readDocument(path)).toMatch(/npm run build\r?\nnpx wrangler deploy --dry-run/);
    });

    it('documents infrastructure usage provider secrets without example token values', () => {
        const docs = readDocumentationSet();
        const localExample = readDocument('.dev.vars.example');

        expect(docs).toContain('SUPABASE_MANAGEMENT_TOKEN');
        expect(docs).toContain('CLOUDFLARE_API_TOKEN');
        expect(docs).toContain('Workers Scripts Read');
        expect(docs).toContain('청구 사용량');
        expect(docs).toContain('cpuTimeUs');
        expect(docs).toContain('responseBytes');
        expect(localExample).toContain('SUPABASE_MANAGEMENT_TOKEN=');
        expect(localExample).toContain('CLOUDFLARE_API_TOKEN=');
        expect(localExample).not.toMatch(/SUPABASE_MANAGEMENT_TOKEN=(?:sbp_|eyJ|[A-Za-z0-9_-]{20,})/);
        expect(localExample).not.toMatch(/CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}/);
    });

    it('documents persistent partner master data and its access boundary', () => {
        const docs = readDocumentationSet();

        expect(docs).toMatch(/companies[\s\S]*sites[\s\S]*partners/i);
        expect(docs).toContain('master.partners');
        expect(docs).toMatch(/MFA-verified[\s\S]*read[\s\S]*administrator/i);
    });

    it('blocks db push until manually applied migrations are reconciled', () => {
        const operations = readDocument(operationsPath);

        expect(operations).toContain('mehhrnbaiojivesnobpv');
        expect(operations).toContain('supabase_migrations.schema_migrations');
        expect(operations).toContain('migration repair --status applied');
        expect(operations).toMatch(/403[\s\S]*Do not run `npx supabase db push`/i);
    });

    it('lists the login authentication migrations in dependency order', () => {
        const operations = readDocument(operationsPath);
        const orderedVersions = orderedAuthenticationMigrationVersions.join('[\\s\\S]*');

        expect(operations).toMatch(new RegExp(orderedVersions));
    });
});
