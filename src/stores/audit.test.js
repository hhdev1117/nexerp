import { describe, expect, it, vi } from 'vitest';
import { AUDIT_ACTION, AUDIT_PAGE_SIZE } from '@/data/audit';
import { AUDIT_ERROR_MESSAGES } from '@/repositories/audit/errors';
import { createAuditStore } from './audit';

const entry = (id) => ({ id, tableName: 'companies', recordId: 'c-1', companyId: 'c-1', action: AUDIT_ACTION.UPDATE, actorId: 'actor', changedAt: '2026-09-15T00:00:00.000Z', oldData: {}, newData: {} });

const stubRepository = (pages) => {
    const listAuditLogs = vi.fn(async (query) => pages.shift() ?? { entries: [entry(1)], total: 1, page: query.page, pageSize: AUDIT_PAGE_SIZE });
    return { listAuditLogs };
};

describe('audit store', () => {
    it('rejects a source that does not implement the contract', () => {
        expect(() => createAuditStore({ repository: {} })).toThrow(TypeError);
    });

    it('loads once through ensureLoaded and exposes the filtered page', async () => {
        const repository = stubRepository([{ entries: [entry(2), entry(1)], total: 2, page: 1, pageSize: AUDIT_PAGE_SIZE }]);
        const store = createAuditStore({ repository });

        await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);

        expect(repository.listAuditLogs).toHaveBeenCalledTimes(1);
        expect(store.entries.value).toHaveLength(2);
        expect(store.total.value).toBe(2);
        expect(store.loaded.value).toBe(true);
        expect(store.loading.value).toBe(false);
        expect(store.error.value).toBeNull();
    });

    it('normalizes screen filters before asking the repository and restarts at the first page', async () => {
        const repository = stubRepository([]);
        const store = createAuditStore({ repository });

        await store.goToPage(3);
        await store.applyFilter({ tableName: 'sites', action: AUDIT_ACTION.INSERT, actorId: 'actor-9' });

        expect(repository.listAuditLogs).toHaveBeenLastCalledWith({ tableName: 'sites', actorId: 'actor-9', action: AUDIT_ACTION.INSERT, from: null, to: null, page: 1 });
        expect(store.hasFilters.value).toBe(true);
        expect(store.filter.value.page).toBe(1);
    });

    it('clamps paging to the available pages and reports how many exist', async () => {
        const repository = stubRepository([{ entries: [entry(1)], total: AUDIT_PAGE_SIZE * 2 + 1, page: 1, pageSize: AUDIT_PAGE_SIZE }]);
        const store = createAuditStore({ repository });

        await store.ensureLoaded();
        expect(store.pageCount.value).toBe(3);

        await store.goToPage(99);
        expect(repository.listAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    });

    it('clears the filter back to the unfiltered first page', async () => {
        const repository = stubRepository([]);
        const store = createAuditStore({ repository });

        await store.applyFilter({ tableName: 'partners' });
        await store.resetFilter();

        expect(store.hasFilters.value).toBe(false);
        expect(repository.listAuditLogs).toHaveBeenLastCalledWith({ tableName: null, actorId: null, action: null, from: null, to: null, page: 1 });
    });

    it('surfaces a Korean message and empties the page when the read is refused', async () => {
        const refusal = Object.assign(new Error('sentinel-provider-detail'), { code: 'admin_required' });
        const store = createAuditStore({ repository: { listAuditLogs: vi.fn().mockRejectedValue(refusal) } });

        await store.ensureLoaded();

        expect(store.error.value).toBe(AUDIT_ERROR_MESSAGES.admin_required);
        expect(store.error.value).not.toContain('sentinel');
        expect(store.entries.value).toEqual([]);
        expect(store.total.value).toBe(0);
        expect(store.loading.value).toBe(false);
    });

    it('keeps the newest request when an earlier one resolves late', async () => {
        const resolvers = [];
        const listAuditLogs = vi.fn(
            (query) =>
                new Promise((resolve) => {
                    resolvers.push(() => resolve({ entries: [entry(query.page)], total: 1, page: query.page, pageSize: AUDIT_PAGE_SIZE }));
                })
        );
        const store = createAuditStore({ repository: { listAuditLogs } });

        const first = store.applyFilter({ tableName: 'companies' });
        const second = store.applyFilter({ tableName: 'sites' });
        resolvers[1]();
        await second;
        resolvers[0]();
        await first;

        expect(store.entries.value).toHaveLength(1);
        expect(store.filter.value.tableName).toBe('sites');
        expect(store.loading.value).toBe(false);
    });
});
