import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./Dashboard.vue', import.meta.url)), 'utf8');

describe('dashboard filters', () => {
    it('connects each visible label to its PrimeVue combobox input', () => {
        expect(source).toContain('<Select inputId="dashboard-company"');
        expect(source).toContain('<Select inputId="dashboard-site"');
        expect(source).toContain('<Select inputId="dashboard-period"');
    });
});
