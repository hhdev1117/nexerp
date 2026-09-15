// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src', 'views', 'master', 'Partners.vue'), 'utf8');

describe('partner management screen', () => {
    it('provides all four partner filters and an accessible data table', () => {
        for (const model of ['selectedCompanyId', 'keyword', 'roleFilter', 'statusFilter']) expect(source).toContain(`v-model="${model}"`);
        expect(source).toContain("'aria-label': '거래처 목록'");
        expect(source).toContain('formatBusinessNumber');
    });

    it('supports customer, vendor and dual-role records', () => {
        expect(source).toContain('isCustomer');
        expect(source).toContain('isVendor');
        expect(source).toContain('고객·공급처');
        expect(source).toContain('validatePartnerDraft');
    });

    it('keeps mutations behind administrator checks and confirmations', () => {
        expect(source).toContain("authStore.hasRole(['admin'])");
        expect(source).toContain('if (!canManage.value) return');
        expect(source).toContain('confirm.require');
        expect(source).toContain('거래처 비활성화');
    });
});
