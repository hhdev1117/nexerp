import { AUDIT_ACTION, AUDIT_PAGE_SIZE } from '@/data/audit';

const NXM = 'demo-company-nxm';
const NXD = 'demo-company-nxd';
const ADMIN = 'demo-actor-admin';
const OPERATOR = 'demo-actor-operator';

// Sample history so the administrator screen behaves identically before Supabase is connected.
const seed = () => [
    { id: 6, tableName: 'partners', recordId: 'demo-partner-1', companyId: NXM, action: AUDIT_ACTION.UPDATE, actorId: ADMIN, changedAt: '2026-09-15T02:10:00.000Z', oldData: { id: 'demo-partner-1', company_id: NXM, code: 'CUS-001', name: '한빛전자', is_customer: true, is_vendor: false, payment_terms_days: 30 }, newData: { id: 'demo-partner-1', company_id: NXM, code: 'CUS-001', name: '한빛전자', is_customer: true, is_vendor: true, payment_terms_days: 45 } },
    { id: 5, tableName: 'partners', recordId: 'demo-partner-1', companyId: NXM, action: AUDIT_ACTION.INSERT, actorId: ADMIN, changedAt: '2026-09-15T01:40:00.000Z', oldData: null, newData: { id: 'demo-partner-1', company_id: NXM, code: 'CUS-001', name: '한빛전자', is_customer: true, is_vendor: false, payment_terms_days: 30 } },
    { id: 4, tableName: 'sites', recordId: 'demo-site-2', companyId: NXD, action: AUDIT_ACTION.UPDATE, actorId: OPERATOR, changedAt: '2026-09-14T08:05:00.000Z', oldData: { id: 'demo-site-2', company_id: NXD, code: 'BSN', name: '부산 물류센터', is_active: true }, newData: { id: 'demo-site-2', company_id: NXD, code: 'BSN', name: '부산 물류센터', is_active: false } },
    { id: 3, tableName: 'sites', recordId: 'demo-site-2', companyId: NXD, action: AUDIT_ACTION.INSERT, actorId: OPERATOR, changedAt: '2026-09-14T07:50:00.000Z', oldData: null, newData: { id: 'demo-site-2', company_id: NXD, code: 'BSN', name: '부산 물류센터', site_type: 'warehouse', is_active: true } },
    { id: 2, tableName: 'companies', recordId: NXM, companyId: NXM, action: AUDIT_ACTION.UPDATE, actorId: ADMIN, changedAt: '2026-09-14T02:30:00.000Z', oldData: { id: NXM, code: 'NXM', name: '넥서스 제조', representative: '' }, newData: { id: NXM, code: 'NXM', name: '넥서스 제조', representative: '김대표' } },
    { id: 1, tableName: 'companies', recordId: NXM, companyId: NXM, action: AUDIT_ACTION.INSERT, actorId: ADMIN, changedAt: '2026-09-14T02:00:00.000Z', oldData: null, newData: { id: NXM, code: 'NXM', name: '넥서스 제조', business_number: '1208812345', is_active: true } }
];

const matches = (entry, query) =>
    (!query.tableName || entry.tableName === query.tableName) &&
    (!query.action || entry.action === query.action) &&
    (!query.actorId || entry.actorId === query.actorId) &&
    (!query.from || entry.changedAt >= query.from) &&
    (!query.to || entry.changedAt <= query.to);

// Mirrors the server contract: newest first, fixed page size, exact total for the applied filter.
export function createDemoAuditRepository({ entries = seed() } = {}) {
    const ledger = [...entries].sort((a, b) => (a.changedAt === b.changedAt ? b.id - a.id : a.changedAt < b.changedAt ? 1 : -1));

    return {
        async listAuditLogs(query = {}) {
            const page = Number.isSafeInteger(query.page) && query.page > 0 ? query.page : 1;
            const filtered = ledger.filter((entry) => matches(entry, query));
            const first = (page - 1) * AUDIT_PAGE_SIZE;
            return { entries: filtered.slice(first, first + AUDIT_PAGE_SIZE), total: filtered.length, page, pageSize: AUDIT_PAGE_SIZE };
        }
    };
}
