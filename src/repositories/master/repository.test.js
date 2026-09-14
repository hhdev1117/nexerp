import { describe, expect, it, vi } from 'vitest';
import { createDemoMasterRepository } from './demoMasterRepository';
import { MASTER_REPOSITORY_METHODS, assertMasterRepository, createDefaultMasterRepository } from './index';

describe('master repository contract', () => {
    it('declares the complete asynchronous contract', () => {
        expect(MASTER_REPOSITORY_METHODS).toEqual(['listCompanies', 'createCompany', 'updateCompany', 'listSites', 'createSite', 'updateSite']);
        for (const method of MASTER_REPOSITORY_METHODS) expect(createDemoMasterRepository()[method]).toEqual(expect.any(Function));
    });

    it.each([null, {}, { listCompanies() {} }, { listCompanies() {}, createCompany() {}, updateCompany() {}, listSites() {}, createSite() {} }])('rejects an incomplete repository %#', (repository) => {
        expect(() => assertMasterRepository(repository)).toThrow(TypeError);
        expect(() => assertMasterRepository(repository)).toThrow('listCompanies, createCompany, updateCompany, listSites, createSite, and updateSite');
    });

    it('returns the same complete repository it validated', () => {
        const repository = createDemoMasterRepository();
        expect(assertMasterRepository(repository)).toBe(repository);
    });

    it('falls back to the demo repository without a Supabase client and uses Supabase when one exists', async () => {
        const demo = createDefaultMasterRepository({ client: null });
        expect((await demo.listCompanies()).map((company) => company.code)).toEqual(['NXD', 'NXM']);

        const order = vi.fn().mockResolvedValue({ data: [], error: null });
        const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ order })) })) };
        const supabase = createDefaultMasterRepository({ client });
        await expect(supabase.listCompanies()).resolves.toEqual([]);
        expect(client.from).toHaveBeenCalledWith('companies');
    });
});
