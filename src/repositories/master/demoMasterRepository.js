import { MASTER_CODE_PATTERN, SITE_TYPE, normalizeCode } from '@/data/master';
import { masterError } from './errors';

export const demoCompanies = Object.freeze([
    Object.freeze({ id: 'company-nxm', code: 'NXM', name: '넥서스 제조', businessNumber: '1208812345', representative: '김정호', address: '인천광역시 남동구 남동대로 100', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }),
    Object.freeze({ id: 'company-nxd', code: 'NXD', name: '넥서스 유통', businessNumber: '2148867890', representative: '이수민', address: '서울특별시 강남구 테헤란로 200', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' })
]);

export const demoSites = Object.freeze([
    Object.freeze({ id: 'site-nxm-hq', companyId: 'company-nxm', code: 'HQ', name: '서울 본사', siteType: SITE_TYPE.HEAD_OFFICE, address: '서울특별시 중구 세종대로 1', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }),
    Object.freeze({ id: 'site-nxm-icn', companyId: 'company-nxm', code: 'ICN', name: '인천 공장', siteType: SITE_TYPE.FACTORY, address: '인천광역시 남동구 남동대로 100', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }),
    Object.freeze({ id: 'site-nxd-bsn', companyId: 'company-nxd', code: 'BSN', name: '부산 물류센터', siteType: SITE_TYPE.WAREHOUSE, address: '부산광역시 강서구 녹산산단로 50', isActive: true, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' })
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

// In-memory implementation that mirrors the database rules (unique codes, active-company
// requirement, cascade deactivation) so the UI behaves the same before Supabase is connected.
export function createDemoMasterRepository({ companies = demoCompanies, sites = demoSites, now = () => new Date() } = {}) {
    const companyState = cloneRows(companies);
    const siteState = cloneRows(sites);
    let sequence = 0;

    const nextId = (prefix) => `${prefix}-${String(++sequence).padStart(3, '0')}`;
    const stamp = () => now().toISOString();
    const findCompany = (id) => companyState.find((company) => company.id === id);
    const findSite = (id) => siteState.find((site) => site.id === id);

    const assertCompanyUnique = (code, businessNumber, exceptId) => {
        if (companyState.some((company) => company.id !== exceptId && company.code === code)) throw masterError('duplicate_code');
        if (businessNumber && companyState.some((company) => company.id !== exceptId && company.businessNumber === businessNumber)) throw masterError('duplicate_code');
    };

    const assertSiteUnique = (companyId, code, exceptId) => {
        if (siteState.some((site) => site.id !== exceptId && site.companyId === companyId && site.code === code)) throw masterError('duplicate_code');
    };

    const assertCode = (code) => {
        if (!MASTER_CODE_PATTERN.test(code)) throw masterError('invalid_value');
    };

    const assertSiteCompany = (site) => {
        const company = findCompany(site.companyId);
        if (!company) throw masterError('not_found');
        if (site.isActive && !company.isActive) throw masterError('company_inactive');
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
        }
    };
}
