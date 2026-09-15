import { MASTER_CODE_PATTERN, SITE_TYPE, normalizeBusinessNumber, normalizeCode, normalizeText } from '@/data/master';
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

// In-memory implementation that mirrors the database rules (unique codes, active-company
// requirement, cascade deactivation) so the UI behaves the same before Supabase is connected.
export function createDemoMasterRepository({ companies = demoCompanies, sites = demoSites, partners = demoPartners, now = () => new Date() } = {}) {
    const companyState = cloneRows(companies);
    const siteState = cloneRows(sites);
    const partnerState = cloneRows(partners);
    let sequence = 0;

    const nextId = (prefix) => `${prefix}-${String(++sequence).padStart(3, '0')}`;
    const stamp = () => now().toISOString();
    const findCompany = (id) => companyState.find((company) => company.id === id);
    const findSite = (id) => siteState.find((site) => site.id === id);
    const findPartner = (id) => partnerState.find((partner) => partner.id === id);

    const assertCompanyUnique = (code, businessNumber, exceptId) => {
        if (companyState.some((company) => company.id !== exceptId && company.code === code)) throw masterError('duplicate_code');
        if (businessNumber && companyState.some((company) => company.id !== exceptId && company.businessNumber === businessNumber)) throw masterError('duplicate_business_number');
    };

    const assertSiteUnique = (companyId, code, exceptId) => {
        if (siteState.some((site) => site.id !== exceptId && site.companyId === companyId && site.code === code)) throw masterError('duplicate_code');
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
                    if (site.companyId === id && site.isActive) Object.assign(site, { isActive: false, updatedAt: stamp() });
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
            Object.assign(site, next, { updatedAt: stamp() });
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
        }
    };
}
