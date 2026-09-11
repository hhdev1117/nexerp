// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { flattenMenuRoutes, erpMenu } from '@/data/erp';
import router from './index';

describe('ERP router', () => {
    it('resolves every navigation destination without falling through', () => {
        for (const item of flattenMenuRoutes(erpMenu)) {
            const resolved = router.resolve(item.to);
            expect(resolved.matched.length, item.to).toBeGreaterThan(0);
            expect(resolved.name, item.to).toBeTruthy();
        }
    });

    it('uses dedicated screens for core workflows', () => {
        expect(router.resolve('/sales/orders').name).toBe('sales-orders');
        expect(router.resolve('/inventory/stock').name).toBe('inventory-stock');
        expect(router.resolve('/approvals').name).toBe('approvals');
        expect(router.resolve('/finance/summary').name).toBe('finance-summary');
    });

    it('registers public auth routes and protected role policies', () => {
        expect(router.resolve('/auth/login')).toMatchObject({ name: 'login', meta: { public: true, guestOnly: true } });
        expect(router.resolve('/auth/setup')).toMatchObject({ name: 'setup-required', meta: { public: true } });
        expect(router.resolve('/auth/access-denied')).toMatchObject({ name: 'access-denied' });
        expect(router.resolve('/approvals').meta.roles).toEqual(['admin', 'approver']);
        expect(router.resolve('/settings/access').meta.roles).toEqual(['admin']);
        expect(router.resolve('/sales/orders').meta.public).not.toBe(true);
    });
});
