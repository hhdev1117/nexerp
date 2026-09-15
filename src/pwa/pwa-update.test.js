import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('PWA release update policy', () => {
    it('configures new releases to update and take control automatically', () => {
        const config = readSource('vite.config.mjs');

        expect(config).toMatch(/registerType:\s*['"]autoUpdate['"]/);
        expect(config).toMatch(/skipWaiting:\s*true/);
        expect(config).toMatch(/clientsClaim:\s*true/);
        expect(config).not.toMatch(/registerType:\s*['"]prompt['"]/);
    });

    it('does not mount a deferrable update prompt in the application shell', () => {
        const app = readSource('src/App.vue');

        expect(app).not.toContain('PwaUpdatePrompt');
        expect(app).not.toContain('나중에');
    });
});
