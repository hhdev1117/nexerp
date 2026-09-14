import { describe, it, expect, vi } from 'vitest';
import { createHrStore } from './hr';
const directory = (name) => ({ employees: [{ name }], permissions: { create: true, update: true }, total: 1, page: 1, pageSize: 25, sites: [], accounts: [] });
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

describe('HR store', () => {
    it('does not retain records after failed refresh and denies writes without loaded grants', async () => {
        const repository = { loadDirectory: vi.fn().mockResolvedValueOnce(directory('A')).mockRejectedValueOnce(new Error('private')), createEmployee: vi.fn() };
        const store = createHrStore({ repository });
        expect(await store.createEmployee({}, 'reason')).toBe(false);
        await store.load('A');
        expect(await store.load('A')).toBe(false);
        expect(store.directory.value).toBeNull();
        expect(store.error.value).not.toContain('private');
        expect(await store.createEmployee({}, 'reason')).toBe(false);
        expect(repository.createEmployee).not.toHaveBeenCalled();
    });
    it('reset discards a pending load from a previous identity', async () => {
        const pending = deferred();
        const store = createHrStore({ repository: { loadDirectory: () => pending.promise } });
        const request = store.load('A');
        store.reset();
        pending.resolve(directory('private'));
        expect(await request).toBe(false);
        expect(store.directory.value).toBeNull();
        expect(store.companyId.value).toBeNull();
        expect(store.loading.value).toBe(false);
    });
    it('clears old company records immediately and ignores late responses', async () => {
        const pending = deferred();
        const repository = { loadDirectory: vi.fn().mockResolvedValueOnce(directory('A')).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(directory('B')) };
        const store = createHrStore({ repository });
        await store.load('A');
        const old = store.load('A', 'old');
        const fresh = store.load('B');
        expect(store.directory.value).toBeNull();
        await fresh;
        pending.resolve(directory('stale'));
        expect(await old).toBe(false);
        expect(store.directory.value.employees[0].name).toBe('B');
    });
    it('reset invalidates pending saves even when the same company is reopened', async () => {
        const pending = deferred();
        const repository = { loadDirectory: vi.fn().mockResolvedValue(directory('A')), createEmployee: () => pending.promise };
        const store = createHrStore({ repository });
        await store.load('A');
        const save = store.createEmployee({}, 'reason');
        store.reset();
        await store.load('A');
        pending.resolve('id');
        expect(await save).toBe(false);
        expect(repository.loadDirectory).toHaveBeenCalledTimes(2);
        expect(store.saving.value).toBe(false);
    });
    it('refreshes the active page after writes and sanitizes failures', async () => {
        const repository = {
            loadDirectory: vi.fn().mockResolvedValue(directory('A')),
            recordAction: vi.fn().mockResolvedValue('id'),
            cancelAction: async () => {
                throw new Error('secret');
            }
        };
        const store = createHrStore({ repository });
        await store.load('A', 'Kim', 2);
        expect(await store.recordAction('employee', 3, { type: 'terminate' })).toBe(true);
        expect(repository.recordAction).toHaveBeenCalledWith('A', 'employee', 3, { type: 'terminate' });
        expect(repository.loadDirectory).toHaveBeenLastCalledWith('A', 'Kim', 2);
        expect(await store.cancelAction('employee', 'action', 4, 'reason')).toBe(false);
        expect(store.error.value).not.toContain('secret');
        expect(store.saving.value).toBe(false);
    });
});
