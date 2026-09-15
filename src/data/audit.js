// Audit ledger rules shared by the repository, store and administrator screen. Pure functions only.

export const AUDIT_ACTION = Object.freeze({ INSERT: 'insert', UPDATE: 'update', DELETE: 'delete' });

const actionLabels = Object.freeze({ insert: '등록', update: '수정', delete: '삭제' });
const actionSeverities = Object.freeze({ insert: 'success', update: 'info', delete: 'danger' });

// Tables the shared trigger currently watches. Add an entry whenever a new trigger is attached.
const auditedTables = Object.freeze({ companies: '회사', sites: '사업장', partners: '거래처', items: '품목', warehouses: '창고' });

const fieldLabels = Object.freeze({
    code: '코드',
    name: '명칭',
    business_number: '사업자등록번호',
    representative: '대표자',
    address: '주소',
    is_active: '사용 여부',
    company_id: '소속 회사',
    site_type: '사업장 유형',
    is_customer: '고객',
    is_vendor: '공급업체',
    contact_name: '담당자',
    email: '이메일',
    phone: '연락처',
    payment_terms_days: '결제 조건(일)',
    credit_limit: '여신 한도',
    item_type: '품목 유형',
    unit: '단위',
    safety_stock: '안전재고',
    standard_price: '표준단가',
    site_id: '사업장',
    warehouse_type: '창고 유형'
});

// The trigger stores a full row snapshot; these columns carry no review value on their own.
const IGNORED_FIELDS = Object.freeze(['id', 'created_at', 'created_by', 'updated_at', 'updated_by']);

export const AUDIT_PAGE_SIZE = 25;

export const auditActionOptions = Object.freeze(Object.entries(actionLabels).map(([value, label]) => Object.freeze({ value, label })));
export const auditedTableOptions = Object.freeze(Object.entries(auditedTables).map(([value, label]) => Object.freeze({ value, label })));
export const AUDITED_TABLES = Object.freeze(Object.keys(auditedTables));

export const auditActionLabel = (code) => actionLabels[code] ?? (typeof code === 'string' ? code : '');
export const auditActionSeverity = (code) => actionSeverities[code] ?? 'secondary';
export const auditedTableLabel = (name) => auditedTables[name] ?? (typeof name === 'string' ? name : '');
export const auditFieldLabel = (field) => fieldLabels[field] ?? (typeof field === 'string' ? field : '');

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Inserts and deletes list every meaningful field; updates list only what actually moved.
export function auditChanges(entry) {
    const before = asObject(entry?.oldData);
    const after = asObject(entry?.newData);
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((field) => !IGNORED_FIELDS.includes(field));

    return fields.map((field) => ({ field, label: auditFieldLabel(field), before: before ? (before[field] ?? null) : null, after: after ? (after[field] ?? null) : null })).filter((change) => !before || !after || !same(change.before, change.after));
}

export function formatAuditValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '예' : '아니오';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

// A readable name for the affected record so reviewers do not have to decode identifiers.
export function auditSubject(entry) {
    const payload = asObject(entry?.newData) ?? asObject(entry?.oldData) ?? {};
    const code = typeof payload.code === 'string' ? payload.code : '';
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (code && name) return `${code} · ${name}`;
    return name || code || entry?.recordId || '';
}

const pad = (value) => String(value).padStart(2, '0');

export function formatAuditTimestamp(value) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return '';
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

export function createAuditFilter() {
    return { tableName: null, actorId: null, action: null, from: null, to: null, page: 1 };
}

const dayBoundary = (value, endOfDay) => {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    const boundary = new Date(value);
    boundary.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return boundary.toISOString();
};

// Screen state becomes repository parameters here so both the demo and Supabase sources agree.
export function auditQuery(filter) {
    const page = Number.isSafeInteger(filter?.page) && filter.page > 0 ? filter.page : 1;
    return {
        tableName: AUDITED_TABLES.includes(filter?.tableName) ? filter.tableName : null,
        actorId: typeof filter?.actorId === 'string' && filter.actorId ? filter.actorId : null,
        action: Object.values(AUDIT_ACTION).includes(filter?.action) ? filter.action : null,
        from: dayBoundary(filter?.from, false),
        to: dayBoundary(filter?.to, true),
        page
    };
}
