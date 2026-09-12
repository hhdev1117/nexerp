// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flattenMenuRoutes, erpMenu } from '@/data/erp';
import router from './index';

const routerSource = readFileSync(resolve(process.cwd(), 'src', 'router', 'index.js'), 'utf8');

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

    it('uses dedicated administrator screens instead of the generic module', () => {
        expect(routerSource).toContain("'/settings/accounts': () => import('@/views/admin/AccountManagement.vue')");
        expect(routerSource).toContain("'/settings/menu-permissions': () => import('@/views/admin/MenuPermissionManagement.vue')");
        expect(routerSource).toContain("'/settings/infrastructure-usage': () => import('@/views/admin/InfrastructureUsage.vue')");
        expect(router.resolve('/settings/accounts').name).toBe('settings-accounts');
        expect(router.resolve('/settings/menu-permissions').name).toBe('settings-menu-permissions');
        expect(router.resolve('/settings/infrastructure-usage').name).toBe('settings-infrastructure-usage');
    });

    it('registers public auth routes and protected role policies', () => {
        expect(router.resolve('/auth/login')).toMatchObject({ name: 'login', meta: { public: true, guestOnly: true } });
        expect(router.resolve('/auth/setup')).toMatchObject({ name: 'setup-required', meta: { public: true } });
        expect(router.resolve('/auth/access-denied')).toMatchObject({ name: 'access-denied' });
        expect(router.resolve('/approvals').meta).toMatchObject({ menuKey: 'approvals' });
        expect(router.resolve('/approvals').meta.roles).toBeUndefined();
        expect(router.resolve('/settings/accounts').meta).toMatchObject({ roles: ['admin'], menuKey: 'settings.accounts', fixedAccess: true });
        expect(router.resolve('/settings/menu-permissions').meta).toMatchObject({ roles: ['admin'], menuKey: 'settings.menu-permissions', fixedAccess: true });
        expect(router.resolve('/settings/infrastructure-usage').meta).toMatchObject({ roles: ['admin'], menuKey: 'settings.infrastructure-usage', fixedAccess: true });
        expect(router.resolve('/sales/orders').meta.public).not.toBe(true);
    });

    it('uses each menu leaf key as the direct-route permission boundary', () => {
        for (const item of flattenMenuRoutes(erpMenu)) {
            expect(router.resolve(item.to).meta.menuKey, item.to).toBe(item.menuKey);
        }
    });

    it('uses the canonical NEXERP browser title', () => {
        expect(routerSource).toContain('`${to.meta.title} | NEXERP`');
        expect(routerSource).toContain(" : 'NEXERP'");
        expect(routerSource).not.toContain('Sakai ERP');
    });
});
