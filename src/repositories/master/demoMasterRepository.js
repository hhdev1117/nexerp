import { ITEM_TYPE, ITEM_UNIT_PATTERN, MASTER_CODE_PATTERN, SITE_TYPE, WAREHOUSE_TYPE, normalizeBusinessNumber, normalizeCode, normalizeText, normalizeUnit } from '@/data/master';
import { masterError } from './errors';

export const demoCompanies = Object.freeze([
    Object.freeze({
        id: 'company-nxm',
        code: 'NXM',
        name: '넥서스 제조',
        businessNumber: '1208812345',
        representative: '김정호',
        address: '인천광역시 남동구 남동대로 100',
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    }),
    Object.freeze({
        id: 'company-nxd',
        code: 'NXD',
        name: '넥서스 유통',
        businessNumber: '2148867890',
        representative: '이수민',
        address: '서울특별시 강남구 테헤란로 200',
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    })
]);

export const demoSites = Object.freeze([
    Object.freeze({
        id: 'site-nxm-hq',
        companyId: 'company-nxm',
        code: 'HQ',
        name: '서울 본사',
        siteType: SITE_TYPE.HEAD_OFFICE,
        address: '서울특별시 중구 세종대로 1',
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    }),
    Object.freeze({
        id: 'site-nxm-icn',
        companyId: 'company-nxm',
        code: 'ICN',
        name: '인천 공장',
        siteType: SITE_TYPE.FACTORY,
        address: '인천광역시 남동구 남동대로 100',
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    }),
    Object.freeze({
        id: 'site-nxd-bsn',
        companyId: 'company-nxd',
        code: 'BSN',
        name: '부산 물류센터',
        siteType: SITE_TYPE.WAREHOUSE,
        address: '부산광역시 강서구 녹산산단로 50',
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    })
]);

export const demoPartners = Object.freeze([
    Object.freeze({
        id: 'partner-nxm-customer',
        companyId: 'company-nxm',
        code: 'CUS-001',
        name: '한빛 유통',
        businessNumber: '1018800001',
        isCustomer: true,
        isVendor: false,
        representative: '이민수',
        contactName: '박소영',
        email: 'sales@hanbit.example',
        phone: '02-1111-2222',
        address: '서울특별시 송파구',
        paymentTermsDays: 30,
        creditLimit: 5000000,
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    }),
    Object.freeze({
        id: 'partner-nxm-vendor',
        companyId: 'company-nxm',
        code: 'VEN-001',
        name: '대성 소재',
        businessNumber: '2018800002',
        isCustomer: false,
        isVendor: true,
        representative: '최서윤',
        contactName: '',
        email: 'supply@daesung.example',
        phone: '031-222-3333',
        address: '경기도 화성시',
        paymentTermsDays: 30,
        creditLimit: 0,
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    }),
    Object.freeze({
        id: 'partner-nxd-dual',
        companyId: 'company-nxd',
        code: 'DUAL-001',
        name: '미래 상사',
        businessNumber: '3018800003',
        isCustomer: true,
        isVendor: true,
        representative: '정지훈',
        contactName: '',
        email: 'office@mirae.example',
        phone: '051-333-4444',
        address: '부산광역시 강서구',
        paymentTermsDays: 45,
        creditLimit: 10000000,
        isActive: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z'
    })
]);

const cloneRows = (rows) => rows.map((row) => ({ ...row }));
const byCode = (rows) => [...rows].sort((a, b) => a.code.localeCompare(b.code));

// Codes mirror the demo inventory rows in src/data/erp.js so stock screens can resolve items.
export const demoItems = Object.freeze(
    [
        { id: 'item-rm-al-001', code: 'RM-AL-001', name: '알루미늄 시트 2T', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 120, standardPrice: 15000 },
        { id: 'item-rm-st-014', code: 'RM-ST-014', name: '스테인리스 파이프', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 180, standardPrice: 22000 },
        { id: 'item-fg-md-220', code: 'FG-MD-220', name: '모터 드라이브 220V', itemType: ITEM_TYPE.FINISHED_GOOD, unit: 'EA', safetyStock: 32, standardPrice: 480000 },
        { id: 'item-pk-bx-008', code: 'PK-BX-008', name: '수출 포장 박스 L', itemType: ITEM_TYPE.CONSUMABLE, unit: 'BOX', safetyStock: 300, standardPrice: 1800 },
        { id: 'item-fg-ct-450', code: 'FG-CT-450', name: '제어반 CT-450', itemType: ITEM_TYPE.FINISHED_GOOD, unit: 'EA', safetyStock: 24, standardPrice: 1250000 }
    ].map((item) => Object.freeze({ ...item, companyId: 'company-nxm', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }))
);

// Names mirror the warehouse labels used by the demo inventory rows in src/data/erp.js.
export const demoWarehouses = Object.freeze(
    [
        { id: 'warehouse-icn-rm', companyId: 'company-nxm', siteId: 'site-nxm-icn', code: 'WH-ICN-RM', name: '인천 원자재창고', warehouseType: WAREHOUSE_TYPE.RAW_MATERIAL },
        { id: 'warehouse-icn-fg', companyId: 'company-nxm', siteId: 'site-nxm-icn', code: 'WH-ICN-FG', name: '인천 완제품창고', warehouseType: WAREHOUSE_TYPE.FINISHED_GOOD },
        { id: 'warehouse-bsn-fg', companyId: 'company-nxd', siteId: 'site-nxd-bsn', code: 'WH-BSN-FG', name: '부산 완제품창고', warehouseType: WAREHOUSE_TYPE.FINISHED_GOOD },
        { id: 'warehouse-bsn-pk', companyId: 'company-nxd', siteId: 'site-nxd-bsn', code: 'WH-BSN-PK', name: '부산 부자재창고', warehouseType: WAREHOUSE_TYPE.PACKAGING }
    ].map((warehouse) => Object.freeze({ ...warehouse, isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }))
);

const withoutIdentity = (fields) => {
    const draft = { ...fields };
    delete draft.id;
    delete draft.createdAt;
    delete draft.updatedAt;
    return draft;
};

const PARTNER_WRITABLE_FIELDS = Object.freeze(['companyId', 'code', 'name', 'businessNumber', 'isCustomer', 'isVendor', 'representative', 'contactName', 'email', 'phone', 'address', 'paymentTermsDays', 'creditLimit', 'isActive']);
const PARTNER_TEXT_FIELDS = Object.freeze(['companyId', 'name', 'representative', 'contactName', 'email', 'phone', 'address']);
const PARTNER_BOOLEAN_FIELDS = Object.freeze(['isCustomer', 'isVendor', 'isActive']);
const partnerFields = (values) => Object.fromEntries(PARTNER_WRITABLE_FIELDS.filter((key) => values?.[key] !== undefined).map((key) => [key, values[key]]));
const BUSINESS_NUMBER_PATTERN = /^\d{10}$/;

const ITEM_WRITABLE_FIELDS = Object.freeze(['companyId', 'code', 'name', 'itemType', 'unit', 'safetyStock', 'standardPrice', 'isActive']);
const itemFields = (values) => Object.fromEntries(ITEM_WRITABLE_FIELDS.filter((key) => values?.[key] !== undefined).map((key) => [key, values[key]]));
const WAREHOUSE_WRITABLE_FIELDS = Object.freeze(['companyId', 'siteId', 'code', 'name', 'warehouseType', 'isActive']);
const warehouseFields = (values) => Object.fromEntries(WAREHOUSE_WRITABLE_FIELDS.filter((key) => values?.[key] !== undefined).map((key) => [key, values[key]]));

// In-memory implementation that mirrors the database rules (unique codes, active-company
// requirement, cascade deactivation) so the UI behaves the same before Supabase is connected.
export function createDemoMasterRepository({ companies = demoCompanies, sites = demoSites, partners = demoPartners, items = demoItems, warehouses = demoWarehouses, now = () => new Date() } = {}) {
    const companyState = cloneRows(companies);
    const siteState = cloneRows(sites);
    const partnerState = cloneRows(partners);
    const itemState = cloneRows(items);
    const warehouseState = cloneRows(warehouses);
    let sequence = 0;

    const nextId = (prefix) => `${prefix}-${String(++sequence).padStart(3, '0')}`;
    const stamp = () => now().toISOString();
    const findCompany = (id) => companyState.find((company) => company.id === id);
    const findSite = (id) => siteState.find((site) => site.id === id);
    const findPartner = (id) => partnerState.find((partner) => partner.id === id);
    const findItem = (id) => itemState.find((row) => row.id === id);
    const findWarehouse = (id) => warehouseState.find((row) => row.id === id);

    const assertCompanyUnique = (code, businessNumber, exceptId) => {
        if (companyState.some((company) => company.id !== exceptId && company.code === code)) throw masterError('duplicate_code');
        if (businessNumber && companyState.some((company) => company.id !== exceptId && company.businessNumber === businessNumber)) throw masterError('duplicate_business_number');
    };

    const assertSiteUnique = (companyId, code, exceptId) => {
        if (siteState.some((site) => site.id !== exceptId && site.companyId === companyId && site.code === code)) throw masterError('duplicate_code');
    };

    const assertItemUnique = (companyId, code, exceptId) => {
        if (itemState.some((row) => row.id !== exceptId && row.companyId === companyId && row.code === code)) throw masterError('duplicate_code');
    };

    const assertWarehouseUnique = (companyId, code, exceptId) => {
        if (warehouseState.some((row) => row.id !== exceptId && row.companyId === companyId && row.code === code)) throw masterError('duplicate_code');
    };

    // The database deactivates a site's warehouses through a trigger; mirror that here.
    const deactivateWarehousesOfSite = (siteId) => {
        for (const row of warehouseState) {
            if (row.siteId === siteId && row.isActive) Object.assign(row, { isActive: false, updatedAt: stamp() });
        }
    };

    const assertPartnerUnique = (companyId, code, businessNumber, exceptId) => {
        if (partnerState.some((partner) => partner.id !== exceptId && partner.companyId === companyId && partner.code === code)) throw masterError('duplicate_code');
        if (businessNumber && partnerState.some((partner) => partner.id !== exceptId && partner.companyId === companyId && partner.businessNumber === businessNumber)) {
            throw masterError('duplicate_business_number');
        }
    };

    const assertCode = (code) => {
        if (!MASTER_CODE_PATTERN.test(code)) throw masterError('invalid_value');
    };

    const assertSiteCompany = (site) => {
        const company = findCompany(site.companyId);
        if (!company) throw masterError('not_found');
        if (site.isActive && !company.isActive) throw masterError('company_inactive');
    };

    const assertPartner = (partner) => {
        assertCode(partner.code);
        if (typeof partner.companyId !== 'string' || !partner.companyId) throw masterError('invalid_value');
        if (PARTNER_TEXT_FIELDS.some((key) => typeof partner[key] !== 'string')) throw masterError('invalid_value');
        if (!partner.name) throw masterError('invalid_value');
        if (PARTNER_BOOLEAN_FIELDS.some((key) => typeof partner[key] !== 'boolean')) throw masterError('invalid_value');
        if (!partner.isCustomer && !partner.isVendor) throw masterError('invalid_value');
        if (partner.businessNumber && !BUSINESS_NUMBER_PATTERN.test(partner.businessNumber)) throw masterError('invalid_value');
        if (!Number.isInteger(partner.paymentTermsDays) || partner.paymentTermsDays < 0 || typeof partner.creditLimit !== 'number' || partner.creditLimit < 0) throw masterError('invalid_value');

        const company = findCompany(partner.companyId);
        if (!company) throw masterError('not_found');
        if (partner.isActive && !company.isActive) throw masterError('company_inactive');
    };

    const normalizePartnerFields = (values) => {
        const fields = partnerFields(values);
        if (fields.code !== undefined) fields.code = normalizeCode(fields.code);
        for (const key of PARTNER_TEXT_FIELDS) {
            if (fields[key] === undefined) continue;
            if (typeof fields[key] !== 'string') throw masterError('invalid_value');
            fields[key] = normalizeText(fields[key]);
        }
        for (const key of PARTNER_BOOLEAN_FIELDS) {
            if (fields[key] !== undefined && typeof fields[key] !== 'boolean') throw masterError('invalid_value');
        }
        if (fields.businessNumber !== undefined) {
            if (fields.businessNumber !== null && typeof fields.businessNumber !== 'string') throw masterError('invalid_value');
            const hasValue = fields.businessNumber !== null && String(fields.businessNumber).trim() !== '';
            fields.businessNumber = normalizeBusinessNumber(fields.businessNumber);
            if (hasValue && !fields.businessNumber) throw masterError('invalid_value');
        }
        if (fields.paymentTermsDays !== undefined && (!Number.isInteger(fields.paymentTermsDays) || fields.paymentTermsDays < 0)) throw masterError('invalid_value');
        if (fields.creditLimit !== undefined && (typeof fields.creditLimit !== 'number' || fields.creditLimit < 0)) throw masterError('invalid_value');
        return fields;
    };

    const normalizeItemFields = (values) => {
        const fields = itemFields(values);
        if (fields.code !== undefined) fields.code = normalizeCode(fields.code);
        if (fields.unit !== undefined) fields.unit = normalizeUnit(fields.unit);
        for (const key of ['companyId', 'name']) {
            if (fields[key] === undefined) continue;
            if (typeof fields[key] !== 'string') throw masterError('invalid_value');
            fields[key] = normalizeText(fields[key]);
        }
        if (fields.isActive !== undefined && typeof fields.isActive !== 'boolean') throw masterError('invalid_value');
        for (const key of ['safetyStock', 'standardPrice']) {
            if (fields[key] !== undefined && (typeof fields[key] !== 'number' || !Number.isFinite(fields[key]) || fields[key] < 0)) throw masterError('invalid_value');
        }
        return fields;
    };

    const assertItem = (row) => {
        assertCode(row.code);
        if (typeof row.companyId !== 'string' || !row.companyId) throw masterError('invalid_value');
        if (typeof row.name !== 'string' || !row.name) throw masterError('invalid_value');
        if (!Object.values(ITEM_TYPE).includes(row.itemType)) throw masterError('invalid_value');
        if (!ITEM_UNIT_PATTERN.test(row.unit)) throw masterError('invalid_value');
        if (typeof row.safetyStock !== 'number' || row.safetyStock < 0 || typeof row.standardPrice !== 'number' || row.standardPrice < 0) throw masterError('invalid_value');

        const company = findCompany(row.companyId);
        if (!company) throw masterError('not_found');
        if (row.isActive && !company.isActive) throw masterError('company_inactive');
    };

    const normalizeWarehouseFields = (values) => {
        const fields = warehouseFields(values);
        if (fields.code !== undefined) fields.code = normalizeCode(fields.code);
        for (const key of ['companyId', 'siteId', 'name']) {
            if (fields[key] === undefined) continue;
            if (typeof fields[key] !== 'string') throw masterError('invalid_value');
            fields[key] = normalizeText(fields[key]);
        }
        if (fields.isActive !== undefined && typeof fields.isActive !== 'boolean') throw masterError('invalid_value');
        return fields;
    };

    const assertWarehouse = (row) => {
        assertCode(row.code);
        if (typeof row.companyId !== 'string' || !row.companyId) throw masterError('invalid_value');
        if (typeof row.name !== 'string' || !row.name) throw masterError('invalid_value');
        if (!Object.values(WAREHOUSE_TYPE).includes(row.warehouseType)) throw masterError('invalid_value');

        const site = findSite(row.siteId);
        if (!site) throw masterError('site_not_found');
        if (site.companyId !== row.companyId) throw masterError('site_company_mismatch');
        if (row.isActive && !site.isActive) throw masterError('site_inactive');
    };

    return {
        async listCompanies() {
            return cloneRows(byCode(companyState));
        },

        async createCompany(draft) {
            const fields = withoutIdentity(draft);
            const code = normalizeCode(fields.code);
            assertCode(code);
            assertCompanyUnique(code, fields.businessNumber ?? null);

            const timestamp = stamp();
            const created = {
                id: nextId('company'),
                code,
                name: fields.name,
                businessNumber: fields.businessNumber ?? null,
                representative: fields.representative ?? '',
                address: fields.address ?? '',
                isActive: fields.isActive !== false,
                createdAt: timestamp,
                updatedAt: timestamp
            };
            companyState.push(created);
            return { ...created };
        },

        async updateCompany(id, changes) {
            const company = findCompany(id);
            if (!company) throw masterError('not_found');

            const fields = withoutIdentity(changes);
            const next = { ...company, ...fields };
            if (fields.code !== undefined) {
                next.code = normalizeCode(fields.code);
                assertCode(next.code);
            }
            assertCompanyUnique(next.code, next.businessNumber ?? null, id);

            const wasActive = company.isActive;
            Object.assign(company, next, { updatedAt: stamp() });
            if (wasActive && !company.isActive) {
                for (const site of siteState) {
                    if (site.companyId !== id || !site.isActive) continue;
                    Object.assign(site, { isActive: false, updatedAt: stamp() });
                    deactivateWarehousesOfSite(site.id);
                }
            }
            return { ...company };
        },

        async listSites() {
            return cloneRows(byCode(siteState));
        },

        async createSite(draft) {
            const fields = withoutIdentity(draft);
            const code = normalizeCode(fields.code);
            assertCode(code);
            const candidate = {
                companyId: fields.companyId,
                code,
                name: fields.name,
                siteType: fields.siteType ?? SITE_TYPE.OTHER,
                address: fields.address ?? '',
                isActive: fields.isActive !== false
            };
            assertSiteCompany(candidate);
            assertSiteUnique(candidate.companyId, candidate.code);

            const timestamp = stamp();
            const site = { id: nextId('site'), ...candidate, createdAt: timestamp, updatedAt: timestamp };
            siteState.push(site);
            return { ...site };
        },

        async updateSite(id, changes) {
            const site = findSite(id);
            if (!site) throw masterError('not_found');

            const fields = withoutIdentity(changes);
            const next = { ...site, ...fields };
            if (fields.code !== undefined) {
                next.code = normalizeCode(fields.code);
                assertCode(next.code);
            }
            assertSiteCompany(next);
            assertSiteUnique(next.companyId, next.code, id);
            const siteWasActive = site.isActive;
            Object.assign(site, next, { updatedAt: stamp() });
            if (siteWasActive && !site.isActive) deactivateWarehousesOfSite(id);
            return { ...site };
        },

        async listPartners() {
            return cloneRows(byCode(partnerState));
        },

        async createPartner(draft) {
            const fields = normalizePartnerFields(withoutIdentity(draft));
            const candidate = {
                companyId: fields.companyId,
                code: fields.code,
                name: fields.name,
                businessNumber: fields.businessNumber ?? null,
                isCustomer: fields.isCustomer === true,
                isVendor: fields.isVendor === true,
                representative: fields.representative ?? '',
                contactName: fields.contactName ?? '',
                email: fields.email ?? '',
                phone: fields.phone ?? '',
                address: fields.address ?? '',
                paymentTermsDays: fields.paymentTermsDays ?? 30,
                creditLimit: fields.creditLimit ?? 0,
                isActive: fields.isActive !== false
            };
            assertPartner(candidate);
            assertPartnerUnique(candidate.companyId, candidate.code, candidate.businessNumber);

            const timestamp = stamp();
            const partner = { id: nextId('partner'), ...candidate, createdAt: timestamp, updatedAt: timestamp };
            partnerState.push(partner);
            return { ...partner };
        },

        async updatePartner(id, changes) {
            const partner = findPartner(id);
            if (!partner) throw masterError('not_found');

            const mutableChanges = withoutIdentity(changes);
            delete mutableChanges.code;
            const fields = normalizePartnerFields(mutableChanges);
            const next = { ...partner, ...fields };
            assertPartner(next);
            assertPartnerUnique(next.companyId, next.code, next.businessNumber, id);
            Object.assign(partner, next, { updatedAt: stamp() });
            return { ...partner };
        },

        async listItems() {
            return cloneRows(byCode(itemState));
        },

        async createItem(draft) {
            const fields = normalizeItemFields(withoutIdentity(draft));
            const candidate = {
                companyId: fields.companyId,
                code: fields.code,
                name: fields.name,
                itemType: fields.itemType ?? ITEM_TYPE.RAW_MATERIAL,
                unit: fields.unit ?? 'EA',
                safetyStock: fields.safetyStock ?? 0,
                standardPrice: fields.standardPrice ?? 0,
                isActive: fields.isActive !== false
            };
            assertItem(candidate);
            assertItemUnique(candidate.companyId, candidate.code);

            const timestamp = stamp();
            const created = { id: nextId('item'), ...candidate, createdAt: timestamp, updatedAt: timestamp };
            itemState.push(created);
            return { ...created };
        },

        async updateItem(id, changes) {
            const row = findItem(id);
            if (!row) throw masterError('not_found');

            const mutableChanges = withoutIdentity(changes);
            delete mutableChanges.code;
            const fields = normalizeItemFields(mutableChanges);
            const next = { ...row, ...fields };
            assertItem(next);
            assertItemUnique(next.companyId, next.code, id);
            Object.assign(row, next, { updatedAt: stamp() });
            return { ...row };
        },

        async listWarehouses() {
            return cloneRows(byCode(warehouseState));
        },

        async createWarehouse(draft) {
            const fields = normalizeWarehouseFields(withoutIdentity(draft));
            const candidate = {
                companyId: fields.companyId,
                siteId: fields.siteId,
                code: fields.code,
                name: fields.name,
                warehouseType: fields.warehouseType ?? WAREHOUSE_TYPE.GENERAL,
                isActive: fields.isActive !== false
            };
            assertWarehouse(candidate);
            assertWarehouseUnique(candidate.companyId, candidate.code);

            const timestamp = stamp();
            const created = { id: nextId('warehouse'), ...candidate, createdAt: timestamp, updatedAt: timestamp };
            warehouseState.push(created);
            return { ...created };
        },

        async updateWarehouse(id, changes) {
            const row = findWarehouse(id);
            if (!row) throw masterError('not_found');

            const mutableChanges = withoutIdentity(changes);
            delete mutableChanges.code;
            const fields = normalizeWarehouseFields(mutableChanges);
            const next = { ...row, ...fields };
            assertWarehouse(next);
            assertWarehouseUnique(next.companyId, next.code, id);
            Object.assign(row, next, { updatedAt: stamp() });
            return { ...row };
        }
    };
}
