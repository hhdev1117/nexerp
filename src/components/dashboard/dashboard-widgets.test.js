import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const notificationSource = readFileSync(fileURLToPath(new URL('./NotificationsWidget.vue', import.meta.url)), 'utf8');
const recentSalesSource = readFileSync(fileURLToPath(new URL('./RecentSalesWidget.vue', import.meta.url)), 'utf8');
const bestSellingSource = readFileSync(fileURLToPath(new URL('./BestSellingWidget.vue', import.meta.url)), 'utf8');

describe('dashboard notification interactions', () => {
    it('exposes approval rows as keyboard-operable links', () => {
        expect(notificationSource).toContain('<RouterLink');
        expect(notificationSource).toContain('to="/approvals"');
        expect(notificationSource).toContain('pendingApprovals');
        expect(recentSalesSource).toContain('recentOrders');
        expect(recentSalesSource).toContain('aria-label="수주 관리로 이동"');
        expect(recentSalesSource).toContain('<h2');
        expect(notificationSource).toContain('<h2');
        expect(bestSellingSource).toContain('<h2');
        expect(bestSellingSource).toContain('{{ item.status }}');
        expect(bestSellingSource).toContain('aria-hidden="true"');
        expect(bestSellingSource).toContain("text: 'text-red-700 dark:text-red-400'");
        expect(bestSellingSource).toContain("text: 'text-orange-700 dark:text-orange-400'");
        expect(recentSalesSource).toContain(":tableProps=\"{ 'aria-label': '최근 수주 목록' }\"");
        expect(notificationSource).toContain(':aria-expanded="menuOpen"');
        expect(notificationSource).toContain('aria-controls="notification-widget-menu"');
        expect(bestSellingSource).toContain(':aria-expanded="menuOpen"');
        expect(bestSellingSource).toContain('aria-controls="stock-widget-menu"');
    });
});
