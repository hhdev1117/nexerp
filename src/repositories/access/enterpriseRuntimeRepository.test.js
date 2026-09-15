import { describe, expect, it, vi } from 'vitest';
import { createEnterpriseRuntimeRepository } from './enterpriseRuntimeRepository';

const context = { mode: 'active', companyId: 'a', companies: [{ id: 'a', name: 'A' }], menuKeys: ['company'], companyActions: ['read'], siteActions: [{ id: 's', actions: ['read'] }], revision: 1 };
describe('enterprise runtime repository', () => {
    it('uses server identity and precise RPC arguments', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: context, error: null });
        const repository = createEnterpriseRuntimeRepository({ rpc });
        expect(await repository.loadContext('a')).toEqual({ ...context, hiddenMenuKeys: [] });
        expect(rpc).toHaveBeenCalledWith('enterprise_access_context', { target_company: 'a' });
        const publication = { revision: 2, draftRevision: 3, active: true };
        rpc.mockResolvedValue({ data: publication });
        expect(await repository.loadPublication('a')).toEqual(publication);
        expect(rpc).toHaveBeenLastCalledWith('enterprise_access_publication', { target_company: 'a' });
        await repository.publish('a', 3, 1, 'reason');
        expect(rpc).toHaveBeenLastCalledWith('enterprise_publish_access_policy', { target_company: 'a', draft_revision: 3, expected_revision: 1, change_reason: 'reason' });
        await repository.revert('a', 2, 'undo');
        expect(rpc).toHaveBeenLastCalledWith('enterprise_revert_access_policy', { target_company: 'a', expected_revision: 2, change_reason: 'undo' });
        rpc.mockResolvedValue({ data: context.companies });
        expect(await repository.listAdminCompanies()).toEqual(context.companies);
        expect(rpc).toHaveBeenLastCalledWith('enterprise_access_companies', {});
    });
    it.each([null, {}, { ...context, mode: 'unknown' }, { ...context, revision: -1 }, { ...context, menuKeys: [true] }, { ...context, companyId: 'b' }, { ...context, companies: [{ id: 'a' }] }, { ...context, mode: 'legacy' }])(
        'rejects malformed context %j',
        async (data) => {
            await expect(createEnterpriseRuntimeRepository({ rpc: async () => ({ data }) }).loadContext()).rejects.toThrow();
        }
    );
    it.each(['PGRST202', '42501', '40001', 'network'])('sanitizes failures without legacy fallback (%s)', async (code) => {
        await expect(
            createEnterpriseRuntimeRepository({
                rpc: async () => {
                    throw { code, message: 'secret SQL payload' };
                }
            }).loadContext()
        ).rejects.not.toThrow('secret');
    });
    it('accepts explicit legacy and empty active contexts', async () => {
        for (const mode of ['legacy', 'active']) {
            const data = { mode, companyId: null, companies: [], menuKeys: [], companyActions: [], siteActions: [], revision: 0 };
            expect(await createEnterpriseRuntimeRepository({ rpc: async () => ({ data }) }).loadContext()).toEqual({ ...data, hiddenMenuKeys: [] });
        }
    });
    it.each([
        { ...context, companyActions: undefined },
        { ...context, siteActions: undefined },
        { ...context, companyActions: ['delete'] },
        { ...context, siteActions: [{ id: 's', actions: [null] }] }
    ])('rejects malformed active action grants %j', async (data) => {
        await expect(createEnterpriseRuntimeRepository({ rpc: async () => ({ data }) }).loadContext()).rejects.toThrow();
    });
    it.each([null, {}, { revision: 1, draftRevision: null, active: 'yes' }])('rejects malformed publication %j', async (data) => {
        await expect(createEnterpriseRuntimeRepository({ rpc: async () => ({ data }) }).loadPublication('a')).rejects.toThrow();
    });
    it('rejects malformed admin catalog and missing client', async () => {
        await expect(createEnterpriseRuntimeRepository({ rpc: async () => ({ data: [{ id: 'a' }] }) }).listAdminCompanies()).rejects.toThrow();
        await expect(createEnterpriseRuntimeRepository(null).loadContext()).rejects.toThrow();
    });
    it('returns only same-company site metadata for policy recovery', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'site', name: '본사', companyId: 'a' }] });
        const repo = createEnterpriseRuntimeRepository({ rpc });
        expect(await repo.listAdminSites('a')).toEqual([{ id: 'site', name: '본사', companyId: 'a' }]);
        expect(rpc).toHaveBeenCalledWith('enterprise_access_sites', { target_company: 'a' });
        await expect(repo.listAdminSites('b')).rejects.toThrow();
    });
});

it('normalizes old hidden menus and rejects visibility outside authorized menus', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: context });
    const repo = createEnterpriseRuntimeRepository({ rpc });
    expect((await repo.loadContext()).hiddenMenuKeys).toEqual([]);
    rpc.mockResolvedValue({ data: { ...context, hiddenMenuKeys: ['company'] } });
    expect((await repo.loadContext()).hiddenMenuKeys).toEqual(['company']);
    for (const hiddenMenuKeys of [null, 'company', [false], ['hr'], ['company', 'company']]) {
        rpc.mockResolvedValue({ data: { ...context, hiddenMenuKeys } });
        await expect(repo.loadContext()).rejects.toThrow();
    }
});
