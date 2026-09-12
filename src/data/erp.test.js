import { describe, expect, it } from 'vitest';
import { erpMenu, filterMenuByAccess, flattenMenuRoutes, formatWon, getDashboardSnapshot, getMenuParentPath, getModuleDefinition, nextOrderNumber, orderRows, statusSeverity, validateOrderDraft } from './erp';

const expectedMenuKeys = [
    'approvals',
    'dashboard',
    'finance.ap',
    'finance.ar',
    'finance.journals',
    'finance.statements',
    'finance.summary',
    'inventory.items',
    'inventory.movements',
    'inventory.stock',
    'inventory.warehouses',
    'logistics.returns',
    'logistics.shipments',
    'master.accounts',
    'master.items',
    'master.partners',
    'production.bom',
    'production.quality',
    'production.schedule',
    'production.work-orders',
    'purchasing.orders',
    'purchasing.receipts',
    'purchasing.vendors',
    'reports.finance',
    'reports.inventory',
    'reports.purchasing',
    'reports.sales',
    'sales.customers',
    'sales.orders',
    'sales.quotes',
    'settings.accounts',
    'settings.audit',
    'settings.company',
    'settings.infrastructure-usage',
    'settings.menu-permissions'
];

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

    it('assigns every navigation leaf the unique key contract seeded by the access migration', () => {
        const keys = flattenMenuRoutes(erpMenu).map((item) => item.menuKey);

        expect(keys.every(Boolean)).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
        expect([...keys].sort()).toEqual(expectedMenuKeys);
    });

    it('recursively removes denied leaves and parents left without visible children', () => {
        const source = [
            {
                label: '업무',
                items: [
                    {
                        label: '영업관리',
                        items: [
                            { label: '수주 관리', to: '/sales/orders', menuKey: 'sales.orders' },
                            { label: '견적 관리', to: '/sales/quotes', menuKey: 'sales.quotes' }
                        ]
                    },
                    {
                        label: '구매관리',
                        items: [{ label: '발주 관리', to: '/purchasing/orders', menuKey: 'purchasing.orders' }]
                    }
                ]
            }
        ];

        const filtered = filterMenuByAccess(source, (menuKey) => menuKey === 'sales.orders');

        expect(filtered).toEqual([
            {
                label: '업무',
                items: [
                    {
                        label: '영업관리',
                        items: [{ label: '수주 관리', to: '/sales/orders', menuKey: 'sales.orders' }]
                    }
                ]
            }
        ]);
        expect(source[0].items).toHaveLength(2);
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
