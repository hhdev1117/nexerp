import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const documentationPaths = ['README.md', 'docs/setup/cloudflare-supabase.md', 'docs/setup/fresh-machine.md'];
const requiredCommands = [
    'npm ci',
    'npm test -- --run',
    'npm run dev',
    'npm run dev:cloudflare',
    'npx supabase db push',
    'npx wrangler secret put',
    'npm run deploy',
    'git pull --ff-only origin main'
];

const readDocumentationSet = () =>
    documentationPaths
        .map((path) => {
            const absolutePath = resolve(process.cwd(), path);
            return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
        })
        .join('\n');

describe('setup documentation', () => {
    it.each(requiredCommands)('documents the exact command `%s`', (command) => {
        expect(readDocumentationSet()).toContain(command);
    });
});
