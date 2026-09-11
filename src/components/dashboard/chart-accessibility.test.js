import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const revenueSource = readFileSync(fileURLToPath(new URL('./RevenueStreamWidget.vue', import.meta.url)), 'utf8');
const financeSource = readFileSync(fileURLToPath(new URL('../../views/erp/FinanceSummary.vue', import.meta.url)), 'utf8');

describe('ERP chart alternatives', () => {
    it.each([revenueSource, financeSource])('labels the canvas and provides a hidden data table', (source) => {
        expect(source).toContain(':pt="chartPassThrough"');
        expect(source).toContain('class="sr-only"');
        expect(source).toContain('<table');
    });

    it('uses section headings around both chart contexts', () => {
        expect(revenueSource).toContain('<h2');
        expect(financeSource.match(/<h2/g)).toHaveLength(2);
        expect(financeSource).toContain(":tableProps=\"{ 'aria-label': '최근 회계 항목 목록' }\"");
    });
});
