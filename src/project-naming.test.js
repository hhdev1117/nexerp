import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const operationalFiles = [
    'package.json',
    'package-lock.json',
    'wrangler.jsonc',
    'supabase/config.toml',
    'docs/setup/cloudflare-supabase.md',
    'docs/setup/fresh-machine.md',
    'docs/superpowers/plans/2026-09-11-cloudflare-supabase-foundation.md',
    'docs/superpowers/plans/2026-09-12-admin-access-nexerp.md',
    'docs/superpowers/specs/2026-09-11-cloudflare-supabase-foundation-design.md',
    'docs/superpowers/specs/2026-09-12-admin-access-nexerp-design.md'
];

const independentlyBrandedFiles = ['index.html', 'src/layout/AppFooter.vue', 'src/components/landing/TopbarWidget.vue', 'src/components/landing/FooterWidget.vue', 'src/views/pages/Documentation.vue'];

describe('NEXERP project naming', () => {
    it('uses the canonical service slug in deployable metadata', () => {
        const packageManifest = JSON.parse(readProjectFile('package.json'));
        const packageLock = JSON.parse(readProjectFile('package-lock.json'));
        const workerConfig = JSON.parse(readProjectFile('wrangler.jsonc'));

        expect(packageManifest.name).toBe('nexerp');
        expect(packageLock.name).toBe('nexerp');
        expect(packageLock.packages[''].name).toBe('nexerp');
        expect(workerConfig.name).toBe('nexerp');
        expect(readProjectFile('supabase/config.toml')).toMatch(/^project_id = "nexerp"$/m);
    });

    it('documents the canonical GitHub clone target and local directory', () => {
        const freshMachineGuide = readProjectFile('docs/setup/fresh-machine.md');

        expect(freshMachineGuide).toContain('git clone https://github.com/hhdev1117/nexerp.git');
        expect(freshMachineGuide).toContain('cd nexerp');
    });

    it('preserves dashboard configuration and requires every Supabase Worker binding', () => {
        const workerConfig = JSON.parse(readProjectFile('wrangler.jsonc'));

        expect(workerConfig.keep_vars).toBe(true);
        expect(workerConfig.secrets?.required).toEqual(
            expect.arrayContaining(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_MANAGEMENT_TOKEN'])
        );
        expect(workerConfig.secrets.required).toHaveLength(4);
    });

    it.each(independentlyBrandedFiles)('uses the NEXERP brand in %s', (path) => {
        const source = readProjectFile(path);

        expect(source).toContain('NEXERP');
        expect(source).not.toMatch(/Sakai ERP|>SAKAI</i);
    });

    it.each(operationalFiles)('does not retain a legacy operational slug in %s', (path) => {
        expect(readProjectFile(path)).not.toMatch(/nxe-erp|nxe-erd|nex-erp|sakai-vue/i);
    });
});
