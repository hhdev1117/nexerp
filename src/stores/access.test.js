import { describe, expect, it, vi } from 'vitest';
import { createAccessStore } from './access';

const makePermission = (role, keys = ['dashboard'], revision = 1) => ({
    role,
    allowed_menu_keys: keys,
    revision,
    updated_at: '2026-09-12T00:00:00.000Z',
    updated_by: null
});

const makeRepository = () => ({
    loadForRole: vi.fn(),
    loadAll: vi.fn(),
    save: vi.fn()
});

describe('access store', () => {
    it('loads and caches only the current non-administrator role', async () => {
        const repository = makeRepository();
        repository.loadForRole.mockResolvedValue(makePermission('user', ['dashboard', 'sales.orders']));
        const store = createAccessStore({ repository });

        await expect(store.ensureLoaded('user')).resolves.toMatchObject({ role: 'user' });
        await store.ensureLoaded('user');

        expect(repository.loadForRole).toHaveBeenCalledOnce();
        expect(repository.loadForRole).toHaveBeenCalledWith('user');
        expect(store.canAccess('sales.orders', 'user')).toBe(true);
        expect(store.canAccess('sales.quotes', 'user')).toBe(false);
    });

    it('fails closed when a non-administrator permission load fails', async () => {
        const repository = makeRepository();
        repository.loadForRole.mockRejectedValue(new Error('sentinel-provider-secret'));
        const store = createAccessStore({ repository });

        await expect(store.ensureLoaded('approver')).resolves.toBeNull();

        expect(store.canAccess('approvals', 'approver')).toBe(false);
        expect(store.error.value).toBe('메뉴 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('sentinel-provider-secret');
    });

    it('fails closed when the role row is missing or belongs to a different role', async () => {
        const repository = makeRepository();
        repository.loadForRole.mockResolvedValueOnce(null).mockResolvedValueOnce(makePermission('approver', ['approvals']));
        const missingStore = createAccessStore({ repository });

        await missingStore.ensureLoaded('user');
        expect(missingStore.canAccess('dashboard', 'user')).toBe(false);

        const mismatchedStore = createAccessStore({ repository });
        await mismatchedStore.ensureLoaded('user');
        expect(mismatchedStore.canAccess('approvals', 'user')).toBe(false);
    });

    it('bootstraps administrator access without depending on a permission request', async () => {
        const repository = makeRepository();
        const store = createAccessStore({ repository });

        await expect(store.ensureLoaded('admin')).resolves.toMatchObject({ role: 'admin', fixed: true });

        expect(repository.loadForRole).not.toHaveBeenCalled();
        expect(store.canAccess('settings.accounts', 'admin')).toBe(true);
        expect(store.canAccess('settings.menu-permissions', 'admin')).toBe(true);
        expect(store.canAccess('sales.orders', 'admin')).toBe(true);
    });

    it('loads all administrator-visible rows and makes them immediately routable', async () => {
        const repository = makeRepository();
        const rows = [makePermission('admin', ['dashboard']), makePermission('approver', ['dashboard', 'approvals']), makePermission('user', ['dashboard'])];
        repository.loadAll.mockResolvedValue(rows);
        const store = createAccessStore({ repository });

        await expect(store.loadAll()).resolves.toEqual(rows);

        expect(store.canAccess('approvals', 'approver')).toBe(true);
        expect(store.canAccess('approvals', 'user')).toBe(false);
    });

    it('saves a role revision and replaces the cached permission row', async () => {
        const repository = makeRepository();
        repository.loadForRole.mockResolvedValue(makePermission('user', ['dashboard'], 2));
        repository.save.mockResolvedValue(makePermission('user', ['dashboard', 'sales.orders'], 3));
        const store = createAccessStore({ repository });
        await store.ensureLoaded('user');

        await expect(store.save('user', ['dashboard', 'sales.orders'], 2)).resolves.toMatchObject({ revision: 3 });

        expect(repository.save).toHaveBeenCalledWith('user', ['dashboard', 'sales.orders'], 2);
        expect(store.canAccess('sales.orders', 'user')).toBe(true);
    });
});
