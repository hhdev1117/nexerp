import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./SalesOrders.vue', import.meta.url)), 'utf8');

describe('sales order form accessibility', () => {
    it('connects PrimeVue form controls to their visible labels', () => {
        expect(source).toContain('<Select inputId="owner"');
        expect(source).toContain('<Select inputId="order-status"');
        expect(source).toContain('inputId="amount"');
        expect(source).toContain('aria-labelledby="owner-label"');
        expect(source).toContain('aria-labelledby="order-status-label"');
        expect(source).toContain('aria-label="수주 검색"');
        expect(source).toContain('aria-label="수주 상태 필터"');
    });

    it('keeps row actions visible while the order table scrolls horizontally', () => {
        expect(source).toContain('scrollable');
        expect(source).toContain('frozen alignFrozen="right"');
        expect(source).toContain(':aria-label="`${slotProps.data.number} 수주 삭제`"');
    });

    it('uses validated dates and shared order state when saving', () => {
        expect(source).toContain('validateOrderDraft(draft.value)');
        expect(source).toContain('useErpStore');
        expect(source).toContain('addOrder(draft.value)');
        expect(source).toContain('deleteOrder(order.id)');
        expect(source).toContain('draftErrors.orderDate');
        expect(source).toContain('draftErrors.dueDate');
        expect(source).toContain('aria-describedby="customer-error"');
        expect(source).toContain('role="alert"');
        expect(source).toContain('document.getElementById(firstErrorId)?.focus()');
        expect(source).toContain(":tableProps=\"{ 'aria-label': '수주 목록' }\"");
        expect(source).toContain('required aria-describedby="customer-error"');
        expect(source).toContain("pcInputText: { root: { 'aria-required': 'true', 'aria-describedby': 'amount-error' } }");
        expect(source).not.toContain(':inputProps=');
    });
});
