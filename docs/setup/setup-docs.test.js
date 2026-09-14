import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const documentationPaths = ['README.md', 'docs/setup/cloudflare-supabase.md', 'docs/setup/fresh-machine.md'];
const operationsPath = 'docs/setup/cloudflare-supabase.md';
const deploymentGuidePaths = [operationsPath, 'docs/setup/fresh-machine.md'];
const requiredCommands = ['npm ci', 'npm test -- --run', 'npm run dev', 'npm run dev:cloudflare', 'npx supabase db push', 'npx wrangler secret put', 'npm run deploy', 'git pull --ff-only origin main'];

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
});
