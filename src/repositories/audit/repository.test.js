import { describe, expect, it, vi } from 'vitest';
import { AUDIT_ACTION, AUDIT_PAGE_SIZE } from '@/data/audit';
import { AUDIT_REPOSITORY_METHODS, assertAuditRepository, createDefaultAuditRepository } from './index';
import { createDemoAuditRepository } from './demoAuditRepository';
import { createSupabaseAuditRepository } from './supabaseAuditRepository';

const row = { id: 9, table_name: 'companies', record_id: 'c-1', company_id: 'c-1', action: 'update', actor_id: 'actor-1', changed_at: '2026-09-15T01:00:00.000Z', old_data: { name: '이전' }, new_data: { name: '이후' } };

const makeClient = (result) => {
    const calls = { table: null, select: null, filters: [], order: [], range: null };
    const builder = {
        eq: vi.fn((column, value) => (calls.filters.push(['eq', column, value]), builder)),
        gte: vi.fn((column, value) => (calls.filters.push(['gte', column, value]), builder)),
        lte: vi.fn((column, value) => (calls.filters.push(['lte', column, value]), builder)),
        order: vi.fn((column, options) => (calls.order.push([column, options?.ascending]), builder)),
        range: vi.fn(async (first, last) => ((calls.range = [first, last]), result))
    };
    const select = vi.fn((fields, options) => ((calls.select = [fields, options]), builder));
    const client = { from: vi.fn((table) => ((calls.table = table), { select })) };
    return { client, calls };
};

describe('audit repository contract', () => {
    it('requires the read-only listing method', () => {
        expect(AUDIT_REPOSITORY_METHODS).toEqual(['listAuditLogs']);
        expect(() => assertAuditRepository({})).toThrow(TypeError);
        expect(() => assertAuditRepository(null)).toThrow(TypeError);
        const repository = createDemoAuditRepository();
        expect(assertAuditRepository(repository)).toBe(repository);
    });

    it('falls back to the demo ledger when Supabase is not configured', async () => {
        const repository = createDefaultAuditRepository({ client: null });
        const page = await repository.listAuditLogs({ page: 1 });
        expect(page.pageSize).toBe(AUDIT_PAGE_SIZE);
        expect(page.entries.length).toBeGreaterThan(0);
    });
});

describe('demo audit repository', () => {
    it('returns the newest entry first', async () => {
        const { entries, total } = await createDemoAuditRepository().listAuditLogs({});
        expect(entries[0].id).toBe(6);
        expect(total).toBe(entries.length);
        expect(entries.map((entry) => entry.changedAt)).toEqual([...entries.map((entry) => entry.changedAt)].sort().reverse());
    });

    it('applies table, action, actor and period filters to both the page and the total', async () => {
        const repository = createDemoAuditRepository();
        expect((await repository.listAuditLogs({ tableName: 'sites' })).total).toBe(2);
        expect((await repository.listAuditLogs({ action: AUDIT_ACTION.INSERT })).total).toBe(3);
        expect((await repository.listAuditLogs({ actorId: 'demo-actor-operator' })).total).toBe(2);
        expect((await repository.listAuditLogs({ from: '2026-09-15T00:00:00.000Z' })).total).toBe(2);
        expect((await repository.listAuditLogs({ to: '2026-09-14T03:00:00.000Z' })).total).toBe(2);
        expect((await repository.listAuditLogs({ tableName: 'sites', action: AUDIT_ACTION.UPDATE })).total).toBe(1);
    });

    it('pages without losing the filtered total', async () => {
        const entries = Array.from({ length: AUDIT_PAGE_SIZE + 4 }, (unused, index) => ({ id: index + 1, tableName: 'companies', recordId: 'c-1', companyId: 'c-1', action: AUDIT_ACTION.UPDATE, actorId: 'actor', changedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, oldData: {}, newData: {} }));
        const repository = createDemoAuditRepository({ entries });
        const first = await repository.listAuditLogs({ page: 1 });
        const second = await repository.listAuditLogs({ page: 2 });
        expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
        expect(second.entries).toHaveLength(4);
        expect(second.total).toBe(AUDIT_PAGE_SIZE + 4);
        expect(first.entries[0].id).toBe(AUDIT_PAGE_SIZE + 4);
    });
});

describe('supabase audit repository', () => {
    it('reads the newest page with an exact total and maps columns to screen fields', async () => {
        const { client, calls } = makeClient({ data: [row], error: null, count: 137 });
        const page = await createSupabaseAuditRepository(client).listAuditLogs({ page: 3 });

        expect(calls.table).toBe('audit_logs');
        expect(calls.select[1]).toEqual({ count: 'exact' });
        expect(calls.order).toEqual([
            ['changed_at', false],
            ['id', false]
        ]);
        expect(calls.range).toEqual([AUDIT_PAGE_SIZE * 2, AUDIT_PAGE_SIZE * 3 - 1]);
        expect(page.total).toBe(137);
        expect(page.page).toBe(3);
        expect(page.entries).toEqual([{ id: 9, tableName: 'companies', recordId: 'c-1', companyId: 'c-1', action: 'update', actorId: 'actor-1', changedAt: '2026-09-15T01:00:00.000Z', oldData: { name: '이전' }, newData: { name: '이후' } }]);
    });

    it('sends only the filters the caller supplied', async () => {
        const { client, calls } = makeClient({ data: [], error: null, count: 0 });
        await createSupabaseAuditRepository(client).listAuditLogs({ tableName: 'sites', action: AUDIT_ACTION.DELETE, actorId: 'actor-1', from: '2026-09-01T00:00:00.000Z', to: '2026-09-15T23:59:59.999Z' });

        expect(calls.filters).toEqual([
            ['eq', 'table_name', 'sites'],
            ['eq', 'action', 'delete'],
            ['eq', 'actor_id', 'actor-1'],
            ['gte', 'changed_at', '2026-09-01T00:00:00.000Z'],
            ['lte', 'changed_at', '2026-09-15T23:59:59.999Z']
        ]);

        const bare = makeClient({ data: [], error: null, count: 0 });
        await createSupabaseAuditRepository(bare.client).listAuditLogs({});
        expect(bare.calls.filters).toEqual([]);
    });

    it('reports a refused read as an administrator requirement without leaking provider detail', async () => {
        const { client } = makeClient({ data: null, error: { code: '42501', message: 'sentinel-provider-detail' }, count: null });
        await expect(createSupabaseAuditRepository(client).listAuditLogs({})).rejects.toMatchObject({ code: 'admin_required' });
        await expect(createSupabaseAuditRepository(client).listAuditLogs({})).rejects.not.toThrow(/sentinel/);
    });

    it('reports other provider failures and a missing client with stable codes', async () => {
        const { client } = makeClient({ data: null, error: { code: '08006', message: 'sentinel-network-detail' }, count: null });
        await expect(createSupabaseAuditRepository(client).listAuditLogs({})).rejects.toMatchObject({ code: 'audit_load_failed' });
        await expect(createSupabaseAuditRepository(null).listAuditLogs({})).rejects.toMatchObject({ code: 'audit_not_configured' });
    });
});
