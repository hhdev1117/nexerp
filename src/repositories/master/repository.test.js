import { describe, expect, it, vi } from 'vitest';
import { createDemoMasterRepository } from './demoMasterRepository';
import { MASTER_ERROR_MESSAGES } from './errors';
import { MASTER_REPOSITORY_METHODS, assertMasterRepository, createDefaultMasterRepository } from './index';

describe('master repository contract', () => {
    it('declares the complete asynchronous contract', () => {
        expect(MASTER_REPOSITORY_METHODS).toEqual([
            'listCompanies',
            'createCompany',
            'updateCompany',
            'listSites',
            'createSite',
            'updateSite',
            'listPartners',
            'createPartner',
            'updatePartner',
            'listItems',
            'createItem',
            'updateItem',
            'listWarehouses',
            'createWarehouse',
            'updateWarehouse'
        ]);
        for (const method of MASTER_REPOSITORY_METHODS) expect(createDemoMasterRepository()[method]).toEqual(expect.any(Function));
    });

    it.each([
        null,
        {},
        { listCompanies() {} },
        {
            listCompanies() {},
            createCompany() {},
            updateCompany() {},
            listSites() {},
            createSite() {},
            updateSite() {},
            listPartners() {},
            createPartner() {},
            updatePartner() {},
            listItems() {},
            createItem() {},
            updateItem() {},
            listWarehouses() {},
            createWarehouse() {}
        }
    ])('rejects an incomplete repository %#', (repository) => {
        // Derived from the contract so a new method does not require editing this string.
        const expectedMethods = `${MASTER_REPOSITORY_METHODS.slice(0, -1).join(', ')}, and ${MASTER_REPOSITORY_METHODS.at(-1)}`;
        expect(() => assertMasterRepository(repository)).toThrow(TypeError);
        expect(() => assertMasterRepository(repository)).toThrow(expectedMethods);
    });

    it('returns the same complete repository it validated', () => {
        const repository = createDemoMasterRepository();
        expect(assertMasterRepository(repository)).toBe(repository);
    });

    it('keeps partner duplicate and inactive-company messages specific and user-safe', () => {
        expect(MASTER_ERROR_MESSAGES.duplicate_code).toBe('이미 사용 중인 코드입니다.');
        expect(MASTER_ERROR_MESSAGES.duplicate_business_number).toBe('이미 사용 중인 사업자등록번호입니다.');
        expect(MASTER_ERROR_MESSAGES.company_inactive).toBe('비활성 회사에는 활성 사업장 또는 거래처를 둘 수 없습니다.');
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
