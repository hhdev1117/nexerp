import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./InventoryStock.vue', import.meta.url)), 'utf8');

describe('inventory filters', () => {
    it('names search controls and exposes a page heading', () => {
        expect(source).toContain('aria-label="재고 검색"');
        expect(source).toContain('aria-label="재고 상태 필터"');
        expect(source).toContain('<h1');
        expect(source).toContain(":tableProps=\"{ 'aria-label': '재고 현황 목록' }\"");
    });
});
