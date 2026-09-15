import { MASTER_REPOSITORY_METHODS } from '@/repositories/master';
import { createDemoMasterRepository } from '@/repositories/master/demoMasterRepository';
import { describe, expect, it, vi } from 'vitest';
import { createMasterStore } from './master';

// Read methods default to an empty collection so adding one to the contract does not break every
// test that only cares about another entity.
const mockRepository = () => Object.fromEntries(MASTER_REPOSITORY_METHODS.map((method) => [method, method.startsWith('list') ? vi.fn().mockResolvedValue([]) : vi.fn()]));

const deferred = () => {
    let resolve;
    const promise = new Promise((next) => {
        resolve = next;
    });
    return { promise, resolve };
};

const partnerRecord = (overrides = {}) => ({
    id: 'partner-1',
    companyId: 'company-1',
    code: 'CUS-001',
    name: '테스트 거래처',
    businessNumber: null,
    isCustomer: true,
    isVendor: false,
    representative: '',
    email: '',
    phone: '',
    address: '',
    isActive: true,
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides
});

describe('master store', () => {
    it('starts company, site, and partner reads before any initial read resolves', async () => {
        const repository = mockRepository();
        const companies = deferred();
        const sites = deferred();
        const partners = deferred();
        repository.listCompanies.mockReturnValue(companies.promise);
        repository.listSites.mockReturnValue(sites.promise);
        repository.listPartners.mockReturnValue(partners.promise);
        const store = createMasterStore({ repository });

        const loading = store.ensureLoaded();
        const callsBeforeResolution = {
            companies: repository.listCompanies.mock.calls.length,
            sites: repository.listSites.mock.calls.length,
            partners: repository.listPartners.mock.calls.length
        };
        companies.resolve([]);
        sites.resolve([]);
        partners.resolve([]);
        await loading;

        expect(callsBeforeResolution).toEqual({ companies: 1, sites: 1, partners: 1 });
        expect(store.loaded.value).toBe(true);
    });

    it('loads master data once, sorted by code, and exposes derived views', async () => {
        const repository = mockRepository();
        repository.listCompanies.mockResolvedValue([
            { id: 'b', code: 'NXM', isActive: true },
            { id: 'a', code: 'NXD', isActive: false }
        ]);
        repository.listSites.mockResolvedValue([
            { id: 's2', companyId: 'b', code: 'ICN', isActive: true },
            { id: 's1', companyId: 'b', code: 'HQ', isActive: false }
        ]);
        repository.listPartners.mockResolvedValue([
            partnerRecord({ id: 'p2', companyId: 'b', code: 'VEN-010', isActive: false }),
            partnerRecord({ id: 'p1', companyId: 'a', code: 'CUS-002' }),
            partnerRecord({ id: 'p3', companyId: 'b', code: 'CUS-001' })
        ]);
        const store = createMasterStore({ repository });

        expect(store.loaded.value).toBe(false);
        await store.ensureLoaded();
        await store.ensureLoaded();

        expect(repository.listCompanies).toHaveBeenCalledOnce();
        expect(repository.listSites).toHaveBeenCalledOnce();
        expect(repository.listPartners).toHaveBeenCalledOnce();
        expect(store.companies.value.map((company) => company.code)).toEqual(['NXD', 'NXM']);
        expect(store.sites.value.map((site) => site.code)).toEqual(['HQ', 'ICN']);
        expect(store.partners.value.map((partner) => partner.code)).toEqual(['CUS-001', 'CUS-002', 'VEN-010']);
        expect(store.activeCompanies.value.map((company) => company.id)).toEqual(['b']);
        expect(store.activeSites.value.map((site) => site.id)).toEqual(['s2']);
        expect(store.activePartners.value.map((partner) => partner.id)).toEqual(['p3', 'p1']);
        expect(store.siteCountByCompany.value).toEqual({ b: 2 });
        expect(store.companyById('a')).toMatchObject({ code: 'NXD' });
        expect(store.companyById('zzz')).toBeNull();
        expect(store.sitesFor('b')).toHaveLength(2);
        expect(store.partnersFor('b').map((partner) => partner.id)).toEqual(['p3', 'p2']);
        expect(store.partnersFor('a').map((partner) => partner.id)).toEqual(['p1']);
        expect(store.partnersFor('missing')).toEqual([]);
        expect(store.loaded.value).toBe(true);
        expect(store.loading.value).toBe(false);
        expect(store.error.value).toBeNull();

        await store.reload();
        expect(repository.listCompanies).toHaveBeenCalledTimes(2);
        expect(repository.listSites).toHaveBeenCalledTimes(2);
        expect(repository.listPartners).toHaveBeenCalledTimes(2);
    });

    it('creates and updates companies, sites, and partners through the repository', async () => {
        const store = createMasterStore({ repository: createDemoMasterRepository() });
        await store.ensureLoaded();

        const created = await store.createCompany({ code: 'NXT', name: '넥서스 테크', businessNumber: null, representative: '', address: '', isActive: true });
        expect(store.companies.value.map((company) => company.code)).toEqual(['NXD', 'NXM', 'NXT']);

        const updated = await store.updateCompany(created.id, { name: '넥서스 테크놀로지' });
        expect(updated.name).toBe('넥서스 테크놀로지');
        expect(store.companyById(created.id).name).toBe('넥서스 테크놀로지');

        const site = await store.createSite({ companyId: created.id, code: 'DJ', name: '대전 지점', siteType: 'branch', address: '', isActive: true });
        expect(store.sitesFor(created.id)).toEqual([site]);

        const updatedSite = await store.updateSite(site.id, { name: '대전 사무소' });
        expect(updatedSite.name).toBe('대전 사무소');
        expect(store.sitesFor(created.id)[0]).toMatchObject({ id: site.id, name: '대전 사무소' });

        const partner = await store.createPartner({
            companyId: created.id,
            code: 'AAA-001',
            name: '새 거래처',
            businessNumber: '1234567890',
            isCustomer: true,
            isVendor: true,
            representative: '',
            email: '',
            phone: '',
            address: '',
            isActive: true
        });
        expect(store.partners.value.map((row) => row.code)).toEqual(['AAA-001', 'CUS-001', 'DUAL-001', 'VEN-001']);

        const updatedPartner = await store.updatePartner(partner.id, { code: 'ZZZ-001', name: '수정 거래처' });
        expect(updatedPartner.name).toBe('수정 거래처');
        expect(updatedPartner.code).toBe('AAA-001');
        expect(store.partners.value).toHaveLength(4);
        expect(store.partners.value.map((row) => row.code)).toEqual(['AAA-001', 'CUS-001', 'DUAL-001', 'VEN-001']);
        expect(store.partners.value.find((row) => row.id === partner.id)).toEqual(updatedPartner);
    });

    it('refreshes sites after a company is deactivated so the cascade is visible', async () => {
        const store = createMasterStore({ repository: createDemoMasterRepository() });
        await store.ensureLoaded();

        await store.updateCompany('company-nxm', { isActive: false });

        expect(store.companyById('company-nxm').isActive).toBe(false);
        expect(store.sitesFor('company-nxm').every((site) => !site.isActive)).toBe(true);
        expect(store.sitesFor('company-nxd').every((site) => site.isActive)).toBe(true);
        expect(store.activeCompanies.value.map((company) => company.code)).toEqual(['NXD']);
    });

    it('does not let a stale overlapping load overwrite newer partner state', async () => {
        const repository = mockRepository();
        const olderPartners = deferred();
        const newerPartners = deferred();
        repository.listCompanies.mockResolvedValue([]);
        repository.listSites.mockResolvedValue([]);
        repository.listPartners.mockReturnValueOnce(olderPartners.promise).mockReturnValueOnce(newerPartners.promise);
        const store = createMasterStore({ repository });

        const olderLoad = store.ensureLoaded();
        const newerLoad = store.reload();
        newerPartners.resolve([partnerRecord({ id: 'newer', code: 'NEW-001' })]);
        await newerLoad;
        olderPartners.resolve([partnerRecord({ id: 'older', code: 'OLD-001' })]);
        await olderLoad;

        expect(store.partners.value.map((partner) => partner.id)).toEqual(['newer']);
    });

    it('mirrors the cascade locally when the site refresh fails', async () => {
        const repository = mockRepository();
        repository.listCompanies.mockResolvedValue([{ id: 'c1', code: 'NXM', isActive: true }]);
        repository.listSites.mockResolvedValueOnce([{ id: 's1', companyId: 'c1', code: 'HQ', isActive: true }]).mockRejectedValueOnce(new Error('sentinel'));
        repository.listPartners.mockResolvedValue([]);
        repository.updateCompany.mockResolvedValue({ id: 'c1', code: 'NXM', isActive: false });
        const store = createMasterStore({ repository });
        await store.ensureLoaded();

        await store.updateCompany('c1', { isActive: false });

        expect(repository.updateCompany).toHaveBeenCalledWith('c1', { isActive: false });
        expect(store.companyById('c1').isActive).toBe(false);
        expect(store.sitesFor('c1')[0].isActive).toBe(false);
    });

    it('surfaces a stable Korean message when loading fails and rethrows save failures untouched', async () => {
        const repository = mockRepository();
        repository.listCompanies.mockRejectedValue(new Error('sentinel-connection-string'));
        repository.listSites.mockResolvedValue([]);
        repository.listPartners.mockResolvedValue([]);
        repository.createCompany.mockRejectedValue(Object.assign(new Error('이미 사용 중인 코드 또는 사업자등록번호입니다.'), { code: 'duplicate_code' }));
        const store = createMasterStore({ repository });

        await store.ensureLoaded();

        expect(store.error.value).toBe('기준정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.loading.value).toBe(false);
        expect(store.loaded.value).toBe(false);
        await expect(store.createCompany({ code: 'NXM' })).rejects.toMatchObject({ code: 'duplicate_code' });
    });

    it('rejects repositories that do not implement the contract', () => {
        expect(() => createMasterStore({ repository: { listCompanies() {} } })).toThrow(TypeError);
    });
});
