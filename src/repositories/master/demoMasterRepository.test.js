import { SITE_TYPE } from '@/data/master';
import { describe, expect, it } from 'vitest';
import { createDemoMasterRepository, demoCompanies, demoSites } from './demoMasterRepository';

const companyDraft = (overrides = {}) => ({ code: 'NXT', name: '넥서스 테크', businessNumber: '3018800001', representative: '박서연', address: '대전광역시 유성구', isActive: true, ...overrides });
const siteDraft = (overrides = {}) => ({ companyId: 'company-nxm', code: 'DJ', name: '대전 지점', siteType: SITE_TYPE.BRANCH, address: '대전광역시 유성구', isActive: true, ...overrides });

describe('demo master repository', () => {
    it('seeds two companies with three sites and returns sorted clones', async () => {
        const repository = createDemoMasterRepository();
        const companies = await repository.listCompanies();
        const sites = await repository.listSites();

        expect(companies.map((company) => company.code)).toEqual(['NXD', 'NXM']);
        expect(sites.map((site) => site.code)).toEqual(['BSN', 'HQ', 'ICN']);

        companies[0].name = 'mutated';
        sites[0].name = 'mutated';
        expect((await repository.listCompanies())[0].name).toBe('넥서스 유통');
        expect((await repository.listSites())[0].name).toBe('부산 물류센터');
        expect(demoCompanies[1].name).toBe('넥서스 유통');
        expect(demoSites[2].name).toBe('부산 물류센터');
    });

    it('creates companies with normalized codes and generated identifiers', async () => {
        const repository = createDemoMasterRepository({ now: () => new Date('2026-09-14T09:00:00.000Z') });
        const created = await repository.createCompany(companyDraft({ code: ' nxt ', id: 'ignored', createdAt: 'ignored' }));

        expect(created).toEqual({
            id: 'company-001',
            code: 'NXT',
            name: '넥서스 테크',
            businessNumber: '3018800001',
            representative: '박서연',
            address: '대전광역시 유성구',
            isActive: true,
            createdAt: '2026-09-14T09:00:00.000Z',
            updatedAt: '2026-09-14T09:00:00.000Z'
        });
        expect((await repository.listCompanies()).map((company) => company.code)).toEqual(['NXD', 'NXM', 'NXT']);
    });

    it('rejects duplicate codes, duplicate business numbers, malformed codes, and unknown rows', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createCompany(companyDraft({ code: 'nxm' }))).rejects.toMatchObject({ name: 'MasterRepositoryError', code: 'duplicate_code' });
        await expect(repository.createCompany(companyDraft({ businessNumber: '1208812345' }))).rejects.toMatchObject({ code: 'duplicate_code' });
        await expect(repository.createCompany(companyDraft({ code: 'NX M' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.updateCompany('company-nxd', { code: 'NXM' })).rejects.toMatchObject({ code: 'duplicate_code' });
        await expect(repository.updateCompany('missing', { name: '없음' })).rejects.toMatchObject({ code: 'not_found' });
        expect((await repository.listCompanies()).map((company) => company.code)).toEqual(['NXD', 'NXM']);
    });

    it('deactivating a company deactivates its sites only', async () => {
        const repository = createDemoMasterRepository();
        const updated = await repository.updateCompany('company-nxm', { isActive: false, id: 'ignored' });

        expect(updated).toMatchObject({ id: 'company-nxm', code: 'NXM', isActive: false });
        const sites = await repository.listSites();
        expect(sites.filter((site) => site.companyId === 'company-nxm').every((site) => !site.isActive)).toBe(true);
        expect(sites.find((site) => site.id === 'site-nxd-bsn').isActive).toBe(true);
    });

    it('keeps active sites under active companies only', async () => {
        const repository = createDemoMasterRepository();
        await repository.updateCompany('company-nxm', { isActive: false });

        await expect(repository.createSite(siteDraft())).rejects.toMatchObject({ code: 'company_inactive' });
        await expect(repository.updateSite('site-nxm-icn', { isActive: true })).rejects.toMatchObject({ code: 'company_inactive' });
        await expect(repository.createSite(siteDraft({ companyId: 'missing' }))).rejects.toMatchObject({ code: 'not_found' });

        const archived = await repository.createSite(siteDraft({ isActive: false }));
        expect(archived).toMatchObject({ id: 'site-001', companyId: 'company-nxm', code: 'DJ', isActive: false });
    });

    it('enforces site code uniqueness per company and updates sites in place', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createSite(siteDraft({ code: 'hq' }))).rejects.toMatchObject({ code: 'duplicate_code' });
        const created = await repository.createSite(siteDraft({ companyId: 'company-nxd', code: 'HQ', name: '유통 본사', siteType: SITE_TYPE.HEAD_OFFICE }));
        expect(created).toMatchObject({ companyId: 'company-nxd', code: 'HQ', siteType: SITE_TYPE.HEAD_OFFICE });

        const updated = await repository.updateSite(created.id, { name: '유통 본점', address: '서울특별시', id: 'ignored' });
        expect(updated).toMatchObject({ id: created.id, code: 'HQ', name: '유통 본점', address: '서울특별시' });
        expect((await repository.listSites()).filter((site) => site.code === 'HQ')).toHaveLength(2);
        await expect(repository.updateSite('missing', { name: '없음' })).rejects.toMatchObject({ code: 'not_found' });
    });
});
