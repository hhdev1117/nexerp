import { describe, expect, it } from 'vitest';
import { erpMenu, flattenMenuRoutes, formatWon, getDashboardSnapshot, getMenuParentPath, getModuleDefinition, nextOrderNumber, orderRows, statusSeverity, validateOrderDraft } from './erp';

describe('ERP template contract', () => {
    it('contains the complete non-HR ERP navigation with unique routes', () => {
        const routes = flattenMenuRoutes(erpMenu);
        const labels = routes.map((item) => item.label).join(' ');

        expect(labels).toContain('수주 관리');
        expect(labels).toContain('재고 현황');
        expect(labels).toContain('재무 현황');
        expect(labels).toContain('작업지시');
        expect(labels).not.toMatch(/인사|급여/);
        expect(new Set(routes.map((item) => item.to)).size).toBe(routes.length);
    });

    it('changes dashboard totals when a site filter is applied', () => {
        const all = getDashboardSnapshot({ company: '전체 회사', site: '전체 사업장', period: '이번 달' });
        const seoul = getDashboardSnapshot({ company: '넥서스 제조', site: '서울 본사', period: '이번 달' });

        expect(all.metrics).toHaveLength(4);
        expect(seoul.metrics[0].rawValue).toBeLessThan(all.metrics[0].rawValue);
        expect(seoul.trend.sales).toHaveLength(6);
    });

    it('provides display helpers and module metadata for operational screens', () => {
        expect(formatWon(534200000)).toBe('₩534.2M');
        expect(statusSeverity('승인 완료')).toBe('success');
        expect(statusSeverity('납기 지연')).toBe('danger');
        expect(getModuleDefinition('/sales/orders').title).toBe('수주 관리');
    });

    it('restores the correct expandable menu parent from the current route', () => {
        expect(getMenuParentPath('/sales/orders')).toBe('/sales');
        expect(getMenuParentPath('/inventory/stock')).toBe('/inventory');
        expect(getMenuParentPath('/logistics/shipments')).toBe('/inventory');
        expect(getMenuParentPath('/approvals')).toBeNull();
        expect(getMenuParentPath('/')).toBeNull();
    });

    it('rejects incomplete or chronologically invalid sales orders', () => {
        const missingDate = validateOrderDraft({ customer: '테스트상사', orderDate: '', dueDate: '2026-09-18', amount: 1000 });
        const reversedDates = validateOrderDraft({ customer: '테스트상사', orderDate: '2026-09-18', dueDate: '2026-09-17', amount: 1000 });
        const valid = validateOrderDraft({ customer: '테스트상사', orderDate: '2026-09-11', dueDate: '2026-09-18', amount: 1000 });

        expect(missingDate.errors.orderDate).toBe(true);
        expect(reversedDates.errors.dueDate).toBe(true);
        expect(valid.isValid).toBe(true);
    });

    it('continues the existing date-specific sales order sequence', () => {
        expect(nextOrderNumber(orderRows, '2026-09-11')).toBe('SO-260911-043');
        expect(nextOrderNumber(orderRows, '2026-09-12')).toBe('SO-260912-001');
    });
});
