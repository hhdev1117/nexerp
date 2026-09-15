import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./Approvals.vue', import.meta.url)), 'utf8');

describe('approval table responsiveness', () => {
    it('keeps approval actions visible while the table scrolls horizontally', () => {
        expect(source).toContain('scrollable');
        expect(source).toContain('frozen alignFrozen="right"');
        expect(source).toContain('whitespace-nowrap');
        expect(source).toContain('aria-label="결재 검색"');
        expect(source).toContain('<h1');
        expect(source).toContain('useErpStore');
        expect(source).toContain(':aria-label="`${slotProps.data.id} 승인`"');
        expect(source).toContain(':aria-label="`${slotProps.data.id} 반려`"');
        expect(source).toContain('focusApprovalWorkflow');
        expect(source).toContain('querySelector(\'[data-approval-action="approve"]\')');
        expect(source).toContain(":tableProps=\"{ 'aria-label': '결재 요청 목록' }\"");
    });
});
