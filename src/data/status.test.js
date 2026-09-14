import { describe, expect, it } from 'vitest';
import { approvalRows, inventoryRows, orderRows } from './erp';
import {
    APPROVAL_STATUS,
    ORDER_STATUS,
    PENDING_APPROVAL_STATUSES,
    STATUS_DEFINITIONS,
    STATUS_DOMAINS,
    STOCK_STATUS,
    TASK_STATUS,
    assertTransition,
    canTransition,
    isPendingApprovalStatus,
    isStatusOf,
    statusLabel,
    statusOptions,
    statusSeverity,
    stockStatusFor
} from './status';

const captureError = (callback) => {
    try {
        callback();
    } catch (error) {
        return error;
    }
    return null;
};

describe('status code table', () => {
    it('maps every registered code to a unique Korean label and a PrimeVue severity', () => {
        const entries = Object.values(STATUS_DEFINITIONS);
        const labels = entries.map((entry) => entry.label);

        expect(new Set(labels).size).toBe(labels.length);
        for (const entry of entries) {
            expect(STATUS_DEFINITIONS[entry.code]).toBe(entry);
            expect(['success', 'info', 'warn', 'danger', 'secondary']).toContain(entry.severity);
        }
        expect(statusLabel(APPROVAL_STATUS.APPROVED)).toBe('승인 완료');
        expect(statusLabel(ORDER_STATUS.OVERDUE)).toBe('납기 지연');
        expect(statusSeverity(APPROVAL_STATUS.APPROVED)).toBe('success');
        expect(statusSeverity(ORDER_STATUS.OVERDUE)).toBe('danger');
        expect(statusSeverity(APPROVAL_STATUS.REJECTED)).toBe('danger');
        expect(statusSeverity(ORDER_STATUS.ON_HOLD)).toBe('secondary');
    });

    it('falls back safely for unknown or missing codes', () => {
        expect(statusLabel('unknown_code')).toBe('unknown_code');
        expect(statusLabel(undefined)).toBe('');
        expect(statusLabel(null)).toBe('');
        expect(statusSeverity('unknown_code')).toBe('secondary');
        expect(statusSeverity(undefined)).toBe('secondary');
    });

    it('only references registered codes from every domain and transition', () => {
        for (const [domain, definition] of Object.entries(STATUS_DOMAINS)) {
            expect(definition.codes, domain).toContain(definition.initial);
            for (const code of definition.codes) expect(STATUS_DEFINITIONS[code], `${domain}:${code}`).toBeDefined();
            for (const [from, targets] of Object.entries(definition.transitions)) {
                expect(definition.codes, `${domain}:${from}`).toContain(from);
                for (const to of targets) {
                    expect(definition.codes, `${domain}:${from}->${to}`).toContain(to);
                    expect(to, `${domain}:${from}`).not.toBe(from);
                }
            }
        }
    });

    it('builds select options in domain order and rejects unknown domains', () => {
        expect(statusOptions('stock')).toEqual([
            { value: 'normal', label: '정상' },
            { value: 'low', label: '부족' },
            { value: 'critical', label: '긴급' }
        ]);
        expect(statusOptions('order').map((option) => option.value)).toEqual(Object.values(ORDER_STATUS));
        expect(statusOptions('task').map((option) => option.value)).toEqual(Object.values(TASK_STATUS));
        expect(() => statusOptions('payroll')).toThrow(TypeError);
        expect(() => canTransition('payroll', 'a', 'b')).toThrow(TypeError);
    });

    it('enforces approval transitions and describes violations without business data', () => {
        expect(canTransition('approval', APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED)).toBe(true);
        expect(canTransition('approval', APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_REVIEW)).toBe(true);
        expect(canTransition('approval', APPROVAL_STATUS.IN_REVIEW, APPROVAL_STATUS.REJECTED)).toBe(true);
        expect(canTransition('approval', APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED)).toBe(false);
        expect(canTransition('approval', APPROVAL_STATUS.REJECTED, APPROVAL_STATUS.APPROVED)).toBe(false);
        expect(canTransition('approval', APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.APPROVED)).toBe(false);
        expect(canTransition('approval', 'unknown', APPROVAL_STATUS.APPROVED)).toBe(false);

        expect(() => assertTransition('approval', APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED)).not.toThrow();
        const error = captureError(() => assertTransition('approval', APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED));
        expect(error).toMatchObject({ name: 'StatusTransitionError', code: 'invalid_status_transition' });
        expect(error.message).toContain('승인 완료');
        expect(error.message).toContain('반려');
    });

    it('enforces order and task transitions', () => {
        expect(canTransition('order', ORDER_STATUS.PENDING_APPROVAL, ORDER_STATUS.APPROVED)).toBe(true);
        expect(canTransition('order', ORDER_STATUS.APPROVED, ORDER_STATUS.AWAITING_SHIPMENT)).toBe(true);
        expect(canTransition('order', ORDER_STATUS.APPROVED, ORDER_STATUS.PENDING_APPROVAL)).toBe(false);
        expect(canTransition('order', ORDER_STATUS.ON_HOLD, ORDER_STATUS.PENDING_APPROVAL)).toBe(true);
        expect(canTransition('task', TASK_STATUS.IN_PROGRESS, TASK_STATUS.DONE)).toBe(true);
        expect(canTransition('task', TASK_STATUS.DONE, TASK_STATUS.IN_PROGRESS)).toBe(false);
        expect(canTransition('stock', STOCK_STATUS.NORMAL, STOCK_STATUS.LOW)).toBe(false);
    });

    it('recognizes which approval statuses still need a decision', () => {
        expect(PENDING_APPROVAL_STATUSES).toEqual([APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_REVIEW]);
        expect(isPendingApprovalStatus(APPROVAL_STATUS.PENDING)).toBe(true);
        expect(isPendingApprovalStatus(APPROVAL_STATUS.IN_REVIEW)).toBe(true);
        expect(isPendingApprovalStatus(APPROVAL_STATUS.APPROVED)).toBe(false);
        expect(isPendingApprovalStatus(APPROVAL_STATUS.REJECTED)).toBe(false);
        expect(isPendingApprovalStatus(undefined)).toBe(false);
    });

    it('derives stock status from the safety threshold', () => {
        expect(stockStatusFor(84, 120)).toBe(STOCK_STATUS.LOW);
        expect(stockStatusFor(12, 32)).toBe(STOCK_STATUS.CRITICAL);
        expect(stockStatusFor(214, 180)).toBe(STOCK_STATUS.NORMAL);
        expect(stockStatusFor(60, 120)).toBe(STOCK_STATUS.LOW);
        expect(stockStatusFor(59, 120)).toBe(STOCK_STATUS.CRITICAL);
        expect(stockStatusFor(0, 0)).toBe(STOCK_STATUS.NORMAL);
        expect(stockStatusFor(undefined, 10)).toBe(STOCK_STATUS.CRITICAL);
    });

    it('keeps every demo record on a registered code of its domain', () => {
        for (const order of orderRows) expect(isStatusOf('order', order.status), order.number).toBe(true);
        for (const approval of approvalRows) expect(isStatusOf('approval', approval.status), approval.id).toBe(true);
        for (const item of inventoryRows) {
            expect(isStatusOf('stock', item.status), item.code).toBe(true);
            expect(item.status, item.code).toBe(stockStatusFor(item.stock, item.safety));
        }
    });
});
