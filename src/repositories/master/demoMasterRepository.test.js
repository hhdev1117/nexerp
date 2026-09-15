import { ACCOUNT_TYPE, ITEM_TYPE, SITE_TYPE, WAREHOUSE_TYPE } from '@/data/master';
import { describe, expect, it } from 'vitest';
import { createDemoMasterRepository, demoAccounts, demoCompanies, demoItems, demoPartners, demoSites, demoWarehouses } from './demoMasterRepository';

const companyDraft = (overrides = {}) => ({ code: 'NXT', name: '넥서스 테크', businessNumber: '3018800001', representative: '박서연', address: '대전광역시 유성구', isActive: true, ...overrides });
const siteDraft = (overrides = {}) => ({ companyId: 'company-nxm', code: 'DJ', name: '대전 지점', siteType: SITE_TYPE.BRANCH, address: '대전광역시 유성구', isActive: true, ...overrides });
const partnerDraft = (overrides = {}) => ({
    companyId: 'company-nxm',
    code: 'NXT-01',
    name: '넥서스 거래처',
    businessNumber: '3018800001',
    isCustomer: true,
    isVendor: false,
    representative: '박서연',
    contactName: '김담당',
    email: 'partner@nexerp.test',
    phone: '02-1234-5678',
    address: '대전광역시 유성구',
    paymentTermsDays: 30,
    creditLimit: 1000000,
    isActive: true,
    ...overrides
});

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

    it('distinguishes duplicate company codes from duplicate company business numbers', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createCompany(companyDraft({ code: 'nxm' }))).rejects.toMatchObject({ name: 'MasterRepositoryError', code: 'duplicate_code' });
        await expect(repository.createCompany(companyDraft({ businessNumber: '1208812345' }))).rejects.toMatchObject({ code: 'duplicate_business_number' });
        await expect(repository.updateCompany('company-nxd', { businessNumber: '1208812345' })).rejects.toMatchObject({ code: 'duplicate_business_number' });
        await expect(repository.updateCompany('company-nxd', { code: 'NXM' })).rejects.toMatchObject({ code: 'duplicate_code' });
    });

    it('rejects malformed company codes and unknown rows', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createCompany(companyDraft({ code: 'NX M' }))).rejects.toMatchObject({ code: 'invalid_value' });
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

    it('seeds customer, vendor, and dual-role partners as sorted clones', async () => {
        const repository = createDemoMasterRepository();
        const partners = await repository.listPartners();

        expect(partners.map((partner) => partner.code)).toEqual(['CUS-001', 'DUAL-001', 'VEN-001']);
        expect(partners.map(({ isCustomer, isVendor }) => [isCustomer, isVendor])).toEqual([
            [true, false],
            [true, true],
            [false, true]
        ]);

        partners[0].name = 'mutated';
        expect((await repository.listPartners())[0].name).not.toBe('mutated');
        expect(demoPartners.find((partner) => partner.code === 'CUS-001').name).not.toBe('mutated');
    });

    it('creates partners with normalized values without mutating caller data', async () => {
        const repository = createDemoMasterRepository({ now: () => new Date('2026-09-14T09:00:00.000Z') });
        const draft = partnerDraft({ code: ' nxt-01 ', businessNumber: '301-88-00001', id: 'ignored', createdAt: 'ignored', updatedAt: 'ignored' });
        const snapshot = { ...draft };

        const created = await repository.createPartner(draft);

        expect(created).toEqual({
            id: 'partner-001',
            companyId: 'company-nxm',
            code: 'NXT-01',
            name: '넥서스 거래처',
            businessNumber: '3018800001',
            isCustomer: true,
            isVendor: false,
            representative: '박서연',
            contactName: '김담당',
            email: 'partner@nexerp.test',
            phone: '02-1234-5678',
            address: '대전광역시 유성구',
            paymentTermsDays: 30,
            creditLimit: 1000000,
            isActive: true,
            createdAt: '2026-09-14T09:00:00.000Z',
            updatedAt: '2026-09-14T09:00:00.000Z'
        });
        expect(draft).toEqual(snapshot);
    });

    it('enforces partner code and business-number uniqueness within each company', async () => {
        const repository = createDemoMasterRepository();
        const source = (await repository.listPartners()).find((partner) => partner.code === 'CUS-001');

        const otherCompany = await repository.createPartner(partnerDraft({ companyId: 'company-nxd', code: source.code, businessNumber: source.businessNumber, name: '타 회사 동일 식별자' }));
        expect(otherCompany).toMatchObject({ companyId: 'company-nxd', code: source.code, businessNumber: source.businessNumber });

        await expect(repository.createPartner(partnerDraft({ code: 'cus-001', businessNumber: '5555500001' }))).rejects.toMatchObject({ code: 'duplicate_code' });
        await expect(repository.createPartner(partnerDraft({ code: 'NEW-01', businessNumber: source.businessNumber }))).rejects.toMatchObject({ code: 'duplicate_business_number' });
        await expect(repository.updatePartner('partner-nxm-vendor', { businessNumber: source.businessNumber })).rejects.toMatchObject({ code: 'duplicate_business_number' });
    });

    it('mirrors partner database validation and active-company requirements', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createPartner(partnerDraft({ code: 'BAD CODE' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ name: '   ' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ isCustomer: false, isVendor: false }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ businessNumber: '123-45' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ businessNumber: 'not-a-number' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ companyId: 'missing' }))).rejects.toMatchObject({ code: 'not_found' });

        await repository.updateCompany('company-nxm', { isActive: false });
        await expect(repository.createPartner(partnerDraft())).rejects.toMatchObject({ code: 'company_inactive' });
        await expect(repository.updatePartner('partner-nxm-customer', { name: '수정 불가' })).rejects.toMatchObject({ code: 'company_inactive' });

        const archived = await repository.createPartner(partnerDraft({ isActive: false }));
        expect(archived).toMatchObject({ companyId: 'company-nxm', code: 'NXT-01', isActive: false });
    });

    it('updates partner timestamps while preserving immutable codes and stripping caller-supplied identity fields', async () => {
        let currentTime = '2026-09-14T10:00:00.000Z';
        const repository = createDemoMasterRepository({ now: () => new Date(currentTime) });
        const changes = { code: ' vendor-02 ', businessNumber: '555-55-00002', name: '수정 공급사', id: 'changed', createdAt: 'changed', updatedAt: 'changed' };
        const snapshot = { ...changes };

        currentTime = '2026-09-14T11:00:00.000Z';
        const updated = await repository.updatePartner('partner-nxm-vendor', changes);

        expect(updated).toMatchObject({
            id: 'partner-nxm-vendor',
            code: 'VEN-001',
            businessNumber: '5555500002',
            name: '수정 공급사',
            createdAt: '2026-01-05T00:00:00.000Z',
            updatedAt: '2026-09-14T11:00:00.000Z'
        });
        expect(changes).toEqual(snapshot);

        updated.name = 'mutated';
        expect((await repository.listPartners()).find((partner) => partner.id === updated.id).name).toBe('수정 공급사');
        await expect(repository.updatePartner('missing', { name: '없음' })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('rejects non-boolean roles and null non-null text fields on create and update', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createPartner(partnerDraft({ representative: null }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.createPartner(partnerDraft({ isVendor: 'true' }))).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.updatePartner('partner-nxm-vendor', { isCustomer: null })).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.updatePartner('partner-nxm-vendor', { email: null })).rejects.toMatchObject({ code: 'invalid_value' });
    });

    it('normalizes partner text fields on create and update', async () => {
        const repository = createDemoMasterRepository();

        const created = await repository.createPartner(partnerDraft({ name: ' 넥서스 거래처 ', representative: ' 박서연 ', email: ' partner@nexerp.test ', phone: ' 02-1234-5678 ', address: ' 대전광역시 유성구 ' }));
        expect(created).toMatchObject({
            name: '넥서스 거래처',
            representative: '박서연',
            email: 'partner@nexerp.test',
            phone: '02-1234-5678',
            address: '대전광역시 유성구'
        });

        const updated = await repository.updatePartner(created.id, { name: ' 수정 거래처 ', email: ' updated@nexerp.test ' });
        expect(updated).toMatchObject({ name: '수정 거래처', email: 'updated@nexerp.test' });
    });
});

const itemDraft = (overrides = {}) => ({ companyId: 'company-nxm', code: 'RM-NEW-001', name: '신규 원자재', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 50, standardPrice: 1000, isActive: true, ...overrides });

describe('demo item master', () => {
    it('seeds the codes the demo inventory rows reference and lists them by code', async () => {
        const listed = await createDemoMasterRepository().listItems();
        expect(listed.map((item) => item.code)).toEqual(['FG-CT-450', 'FG-MD-220', 'PK-BX-008', 'RM-AL-001', 'RM-ST-014']);
        expect(demoItems.every((item) => item.companyId === 'company-nxm')).toBe(true);
    });

    it('normalizes the code and unit, then issues identity on create', async () => {
        const repository = createDemoMasterRepository();
        const created = await repository.createItem(itemDraft({ code: ' rm-new-001 ', unit: ' ea ', name: ' 신규 원자재 ' }));

        expect(created).toMatchObject({ code: 'RM-NEW-001', unit: 'EA', name: '신규 원자재', safetyStock: 50, standardPrice: 1000, isActive: true });
        expect(created.id).toMatch(/^item-\d{3}$/);
        expect(created.createdAt).toBe(created.updatedAt);
    });

    it('scopes code uniqueness to the company', async () => {
        const repository = createDemoMasterRepository();
        await repository.createItem(itemDraft());
        await expect(repository.createItem(itemDraft())).rejects.toMatchObject({ code: 'duplicate_code' });
        await expect(repository.createItem(itemDraft({ companyId: 'company-nxd' }))).resolves.toMatchObject({ code: 'RM-NEW-001' });
    });

    it('keeps the code immutable and rejects unusable amounts', async () => {
        const repository = createDemoMasterRepository();
        const created = await repository.createItem(itemDraft());

        const updated = await repository.updateItem(created.id, { code: 'CHANGED', name: '수정 원자재', safetyStock: 75 });
        expect(updated).toMatchObject({ code: 'RM-NEW-001', name: '수정 원자재', safetyStock: 75 });

        await expect(repository.updateItem(created.id, { safetyStock: -1 })).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.updateItem(created.id, { standardPrice: -1 })).rejects.toMatchObject({ code: 'invalid_value' });
        await expect(repository.updateItem('missing', { name: '없음' })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('refuses an active item under an inactive company', async () => {
        const repository = createDemoMasterRepository();
        await repository.updateCompany('company-nxd', { isActive: false });

        await expect(repository.createItem(itemDraft({ companyId: 'company-nxd' }))).rejects.toMatchObject({ code: 'company_inactive' });
        await expect(repository.createItem(itemDraft({ companyId: 'company-nxd', isActive: false }))).resolves.toMatchObject({ isActive: false });
        await expect(repository.createItem(itemDraft({ companyId: 'missing-company' }))).rejects.toMatchObject({ code: 'not_found' });
    });
});

const warehouseDraft = (overrides = {}) => ({ companyId: 'company-nxm', siteId: 'site-nxm-icn', code: 'WH-NEW', name: '신규 창고', warehouseType: WAREHOUSE_TYPE.GENERAL, isActive: true, ...overrides });

describe('demo warehouse master', () => {
    it('seeds the warehouse names the demo inventory rows reference', async () => {
        const listed = await createDemoMasterRepository().listWarehouses();
        expect(listed.map((warehouse) => warehouse.code)).toEqual(['WH-BSN-FG', 'WH-BSN-PK', 'WH-ICN-FG', 'WH-ICN-RM']);
        expect(demoWarehouses.every((warehouse) => warehouse.isActive)).toBe(true);
    });

    it('requires the site to exist and to belong to the same company', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createWarehouse(warehouseDraft({ siteId: 'missing-site' }))).rejects.toMatchObject({ code: 'site_not_found' });
        await expect(repository.createWarehouse(warehouseDraft({ siteId: 'site-nxd-bsn' }))).rejects.toMatchObject({ code: 'site_company_mismatch' });
        await expect(repository.createWarehouse(warehouseDraft())).resolves.toMatchObject({ code: 'WH-NEW', siteId: 'site-nxm-icn' });
    });

    it('scopes code uniqueness to the company and keeps the code immutable', async () => {
        const repository = createDemoMasterRepository();
        const created = await repository.createWarehouse(warehouseDraft());

        await expect(repository.createWarehouse(warehouseDraft())).rejects.toMatchObject({ code: 'duplicate_code' });
        await expect(repository.createWarehouse(warehouseDraft({ companyId: 'company-nxd', siteId: 'site-nxd-bsn' }))).resolves.toMatchObject({ code: 'WH-NEW' });

        const updated = await repository.updateWarehouse(created.id, { code: 'CHANGED', name: '수정 창고' });
        expect(updated).toMatchObject({ code: 'WH-NEW', name: '수정 창고' });
        await expect(repository.updateWarehouse('missing', { name: '없음' })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('deactivates the warehouses of a site, directly and through the company cascade', async () => {
        const repository = createDemoMasterRepository();

        await repository.updateSite('site-nxm-icn', { isActive: false });
        const afterSite = await repository.listWarehouses();
        expect(afterSite.filter((warehouse) => warehouse.siteId === 'site-nxm-icn').every((warehouse) => !warehouse.isActive)).toBe(true);
        await expect(repository.updateWarehouse('warehouse-icn-rm', { isActive: true })).rejects.toMatchObject({ code: 'site_inactive' });

        await repository.updateCompany('company-nxd', { isActive: false });
        const afterCompany = await repository.listWarehouses();
        expect(afterCompany.some((warehouse) => warehouse.isActive)).toBe(false);
    });
});

const accountDraft = (overrides = {}) => ({ companyId: 'company-nxm', parentId: 'account-110', code: '113', name: '단기금융상품', accountType: ACCOUNT_TYPE.ASSET, isPostable: true, isActive: true, ...overrides });

describe('demo chart of accounts', () => {
    it('seeds a usable Korean chart with summary and postable accounts', async () => {
        const listed = await createDemoMasterRepository().listAccounts();
        expect(listed).toHaveLength(demoAccounts.length);
        expect(listed.filter((account) => account.isPostable).map((account) => account.code)).toEqual(['111', '112', '211', '311', '411', '511']);
    });

    it('refuses a parent from another type, a postable parent and a missing parent', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.createAccount(accountDraft({ accountType: ACCOUNT_TYPE.REVENUE }))).rejects.toMatchObject({ code: 'parent_type_mismatch' });
        await expect(repository.createAccount(accountDraft({ parentId: 'account-111' }))).rejects.toMatchObject({ code: 'parent_is_postable' });
        await expect(repository.createAccount(accountDraft({ parentId: 'missing' }))).rejects.toMatchObject({ code: 'parent_not_found' });
        await expect(repository.createAccount(accountDraft())).resolves.toMatchObject({ code: '113', parentId: 'account-110' });
    });

    it('refuses a loop, including an account pointing at itself', async () => {
        const repository = createDemoMasterRepository();

        await expect(repository.updateAccount('account-110', { parentId: 'account-110' })).rejects.toMatchObject({ code: 'invalid_parent' });
        await expect(repository.updateAccount('account-100', { parentId: 'account-111' })).rejects.toMatchObject({ code: 'parent_is_postable' });
        await expect(repository.updateAccount('account-100', { parentId: 'account-110' })).rejects.toMatchObject({ code: 'invalid_parent' });
    });

    it('deactivates every descendant and blocks reviving a child alone', async () => {
        const repository = createDemoMasterRepository();

        await repository.updateAccount('account-100', { isActive: false });
        const listed = await repository.listAccounts();
        expect(listed.filter((account) => ['account-100', 'account-110', 'account-111', 'account-112'].includes(account.id)).every((account) => !account.isActive)).toBe(true);
        expect(listed.find((account) => account.id === 'account-200').isActive).toBe(true);

        await expect(repository.updateAccount('account-111', { isActive: true })).rejects.toMatchObject({ code: 'parent_inactive' });
    });
});
