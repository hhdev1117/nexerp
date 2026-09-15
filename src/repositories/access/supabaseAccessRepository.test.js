import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAccessRepository } from './supabaseAccessRepository';

const permissionRow = {
    role: 'user',
    allowed_menu_keys: ['dashboard', 'sales.orders'],
    revision: 3,
    updated_at: '2026-09-12T00:00:00.000Z',
    updated_by: null
};

const makeClient = ({ ownRoleResult, allResult, saveResult } = {}) => {
    const maybeSingle = vi.fn().mockResolvedValue(ownRoleResult || { data: permissionRow, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn().mockResolvedValue(allResult || { data: [permissionRow], error: null });
    const select = vi.fn(() => ({ eq, order }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockResolvedValue(saveResult || { data: permissionRow, error: null });

    return { client: { from, rpc }, from, select, eq, maybeSingle, order, rpc };
};

describe('Supabase access repository', () => {
    it('loads only the permission row for the signed-in profile role', async () => {
        const fixture = makeClient();
        const repository = createSupabaseAccessRepository(fixture.client);

        await expect(repository.loadForRole('user')).resolves.toEqual(permissionRow);
        expect(fixture.from).toHaveBeenCalledWith('role_menu_permissions');
        expect(fixture.select).toHaveBeenCalledWith('role, allowed_menu_keys, revision, updated_at, updated_by');
        expect(fixture.eq).toHaveBeenCalledWith('role', 'user');
        expect(fixture.maybeSingle).toHaveBeenCalledOnce();
    });

    it('loads all visible role rows for administrator management', async () => {
        const rows = [permissionRow, { ...permissionRow, role: 'approver' }];
        const fixture = makeClient({ allResult: { data: rows, error: null } });
        const repository = createSupabaseAccessRepository(fixture.client);

        await expect(repository.loadAll()).resolves.toEqual(rows);
        expect(fixture.order).toHaveBeenCalledWith('role');
    });

    it('saves through the protected optimistic-concurrency RPC', async () => {
        const updated = { ...permissionRow, allowed_menu_keys: ['dashboard'], revision: 4 };
        const fixture = makeClient({ saveResult: { data: updated, error: null } });
        const repository = createSupabaseAccessRepository(fixture.client);

        await expect(repository.save('user', ['dashboard'], 3)).resolves.toEqual(updated);
        expect(fixture.rpc).toHaveBeenCalledWith('admin_replace_role_menu_permissions', {
            target_role: 'user',
            allowed_keys: ['dashboard'],
            expected_revision: 3
        });
    });

    it('normalizes provider failures without exposing raw details', async () => {
        const fixture = makeClient({ ownRoleResult: { data: null, error: new Error('sentinel-provider-secret') } });
        const repository = createSupabaseAccessRepository(fixture.client);

        await expect(repository.loadForRole('user')).rejects.toMatchObject({ name: 'AccessRepositoryError', code: 'access_load_failed' });
        await expect(repository.loadForRole('user')).rejects.not.toThrow('sentinel-provider-secret');
    });

    it('preserves revision conflict as a stable repository error code', async () => {
        const fixture = makeClient({ saveResult: { data: null, error: { code: '40001', message: 'revision_conflict' } } });
        const repository = createSupabaseAccessRepository(fixture.client);

        await expect(repository.save('user', ['dashboard'], 1)).rejects.toMatchObject({ name: 'AccessRepositoryError', code: 'revision_conflict' });
    });
});
