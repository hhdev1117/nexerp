import { MASTER_REPOSITORY_METHODS } from '@/repositories/master';
import { createDemoMasterRepository } from '@/repositories/master/demoMasterRepository';
import { describe, expect, it, vi } from 'vitest';
import { createMasterStore } from './master';

const mockRepository = () => Object.fromEntries(MASTER_REPOSITORY_METHODS.map((method) => [method, vi.fn()]));

describe('master store', () => {
    it('loads companies and sites once, sorted by code, and exposes derived views', async () => {
        const repository = mockRepository();
        repository.listCompanies.mockResolvedValue([
            { id: 'b', code: 'NXM', isActive: true },
            { id: 'a', code: 'NXD', isActive: false }
        ]);
        repository.listSites.mockResolvedValue([
            { id: 's2', companyId: 'b', code: 'ICN', isActive: true },
            { id: 's1', companyId: 'b', code: 'HQ', isActive: false }
        ]);
        const store = createMasterStore({ repository });

        expect(store.loaded.value).toBe(false);
        await store.ensureLoaded();
        await store.ensureLoaded();

        expect(repository.listCompanies).toHaveBeenCalledOnce();
        expect(store.companies.value.map((company) => company.code)).toEqual(['NXD', 'NXM']);
        expect(store.sites.value.map((site) => site.code)).toEqual(['HQ', 'ICN']);
        expect(store.activeCompanies.value.map((company) => company.id)).toEqual(['b']);
        expect(store.activeSites.value.map((site) => site.id)).toEqual(['s2']);
        expect(store.siteCountByCompany.value).toEqual({ b: 2 });
        expect(store.companyById('a')).toMatchObject({ code: 'NXD' });
        expect(store.companyById('zzz')).toBeNull();
        expect(store.sitesFor('b')).toHaveLength(2);
        expect(store.loaded.value).toBe(true);
        expect(store.loading.value).toBe(false);
        expect(store.error.value).toBeNull();

        await store.reload();
        expect(repository.listCompanies).toHaveBeenCalledTimes(2);
    });

    it('creates and updates companies and sites through the repository', async () => {
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

    it('mirrors the cascade locally when the site refresh fails', async () => {
        const repository = mockRepository();
        repository.listCompanies.mockResolvedValue([{ id: 'c1', code: 'NXM', isActive: true }]);
        repository.listSites.mockResolvedValueOnce([{ id: 's1', companyId: 'c1', code: 'HQ', isActive: true }]).mockRejectedValueOnce(new Error('sentinel'));
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
