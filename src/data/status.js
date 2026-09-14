// Single source of truth for business status codes.
// Records store the English `code`; screens render the Korean `label` and PrimeVue `severity`.

const definitions = [
    ['pending_approval', '승인 대기', 'warn'],
    ['in_review', '검토 중', 'info'],
    ['approved', '승인 완료', 'success'],
    ['rejected', '반려', 'danger'],
    ['awaiting_shipment', '출고 대기', 'warn'],
    ['overdue', '납기 지연', 'danger'],
    ['on_hold', '보류', 'secondary'],
    ['in_progress', '진행중', 'info'],
    ['done', '완료', 'success'],
    ['normal', '정상', 'success'],
    ['low', '부족', 'warn'],
    ['critical', '긴급', 'danger']
];

export const STATUS_DEFINITIONS = Object.freeze(Object.fromEntries(definitions.map(([code, label, severity]) => [code, Object.freeze({ code, label, severity })])));

export const ORDER_STATUS = Object.freeze({
    PENDING_APPROVAL: 'pending_approval',
    IN_REVIEW: 'in_review',
    APPROVED: 'approved',
    AWAITING_SHIPMENT: 'awaiting_shipment',
    OVERDUE: 'overdue',
    ON_HOLD: 'on_hold'
});

export const APPROVAL_STATUS = Object.freeze({
    PENDING: 'pending_approval',
    IN_REVIEW: 'in_review',
    APPROVED: 'approved',
    REJECTED: 'rejected'
});

export const TASK_STATUS = Object.freeze({
    IN_PROGRESS: 'in_progress',
    PENDING_APPROVAL: 'pending_approval',
    DONE: 'done',
    ON_HOLD: 'on_hold'
});

export const STOCK_STATUS = Object.freeze({
    NORMAL: 'normal',
    LOW: 'low',
    CRITICAL: 'critical'
});

const defineDomain = (statuses, initial, transitions) => {
    const codes = Object.freeze(Object.values(statuses));
    return Object.freeze({
        codes,
        initial,
        transitions: Object.freeze(Object.fromEntries(codes.map((code) => [code, Object.freeze([...(transitions[code] || [])])])))
    });
};

// Allowed state changes per business domain. A code missing from the map is terminal.
export const STATUS_DOMAINS = Object.freeze({
    order: defineDomain(ORDER_STATUS, ORDER_STATUS.PENDING_APPROVAL, {
        pending_approval: ['in_review', 'approved', 'on_hold'],
        in_review: ['approved', 'pending_approval', 'on_hold'],
        approved: ['awaiting_shipment', 'on_hold'],
        awaiting_shipment: ['overdue', 'on_hold'],
        overdue: ['awaiting_shipment', 'on_hold'],
        on_hold: ['pending_approval']
    }),
    approval: defineDomain(APPROVAL_STATUS, APPROVAL_STATUS.PENDING, {
        pending_approval: ['in_review', 'approved', 'rejected'],
        in_review: ['approved', 'rejected']
    }),
    task: defineDomain(TASK_STATUS, TASK_STATUS.IN_PROGRESS, {
        in_progress: ['pending_approval', 'done', 'on_hold'],
        pending_approval: ['in_progress', 'done', 'on_hold'],
        on_hold: ['in_progress']
    }),
    stock: defineDomain(STOCK_STATUS, STOCK_STATUS.NORMAL, {})
});

export const PENDING_APPROVAL_STATUSES = Object.freeze([APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_REVIEW]);

export const isPendingApprovalStatus = (code) => PENDING_APPROVAL_STATUSES.includes(code);

function getDomain(domain) {
    const definition = STATUS_DOMAINS[domain];
    if (!definition) throw new TypeError(`Unknown status domain: ${String(domain)}`);
    return definition;
}

export function statusLabel(code) {
    return STATUS_DEFINITIONS[code]?.label ?? (typeof code === 'string' ? code : '');
}

export function statusSeverity(code) {
    return STATUS_DEFINITIONS[code]?.severity ?? 'secondary';
}

export function statusOptions(domain) {
    return getDomain(domain).codes.map((code) => ({ value: code, label: statusLabel(code) }));
}

export function isStatusOf(domain, code) {
    return getDomain(domain).codes.includes(code);
}

export function canTransition(domain, from, to) {
    return Boolean(getDomain(domain).transitions[from]?.includes(to));
}

export function assertTransition(domain, from, to) {
    if (canTransition(domain, from, to)) return;

    const error = new Error(`'${statusLabel(from)}' 상태에서 '${statusLabel(to)}' 상태로 변경할 수 없습니다.`);
    error.name = 'StatusTransitionError';
    error.code = 'invalid_status_transition';
    throw error;
}

export function stockStatusFor(stock, safety) {
    if (!Number.isFinite(safety) || safety <= 0) return STOCK_STATUS.NORMAL;
    const quantity = Number.isFinite(stock) ? stock : 0;
    if (quantity < safety * 0.5) return STOCK_STATUS.CRITICAL;
    if (quantity < safety) return STOCK_STATUS.LOW;
    return STOCK_STATUS.NORMAL;
}
