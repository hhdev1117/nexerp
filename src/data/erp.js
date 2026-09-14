import { APPROVAL_STATUS, ORDER_STATUS, STOCK_STATUS } from './status';

const makeItem = (menuKey, label, icon, to, description) => ({ menuKey, label, icon, to, description });

export const erpMenu = [
    {
        label: '개요',
        items: [makeItem('dashboard', '통합 대시보드', 'pi pi-fw pi-home', '/', '전사 핵심 현황을 확인합니다.')]
    },
    {
        label: '업무',
        items: [
            makeItem('approvals', '결재함', 'pi pi-fw pi-check-square', '/approvals', '승인 요청과 처리 이력을 관리합니다.'),
            {
                label: '영업관리',
                icon: 'pi pi-fw pi-chart-line',
                path: '/sales',
                items: [
                    makeItem('sales.quotes', '견적 관리', 'pi pi-fw pi-file-edit', '/sales/quotes', '고객 견적과 유효기간을 관리합니다.'),
                    makeItem('sales.orders', '수주 관리', 'pi pi-fw pi-shopping-cart', '/sales/orders', '수주부터 출하 요청까지 관리합니다.'),
                    makeItem('sales.customers', '거래처 관리', 'pi pi-fw pi-building', '/sales/customers', '고객사와 거래 조건을 관리합니다.')
                ]
            },
            {
                label: '구매관리',
                icon: 'pi pi-fw pi-shopping-bag',
                path: '/purchasing',
                items: [
                    makeItem('purchasing.orders', '발주 관리', 'pi pi-fw pi-file-export', '/purchasing/orders', '구매 발주와 납기를 관리합니다.'),
                    makeItem('purchasing.receipts', '입고 관리', 'pi pi-fw pi-sign-in', '/purchasing/receipts', '검수 및 입고 처리를 관리합니다.'),
                    makeItem('purchasing.vendors', '공급업체 관리', 'pi pi-fw pi-truck', '/purchasing/vendors', '공급업체와 구매 조건을 관리합니다.')
                ]
            },
            {
                label: '재고 · 물류',
                icon: 'pi pi-fw pi-box',
                path: '/inventory',
                items: [
                    makeItem('inventory.stock', '재고 현황', 'pi pi-fw pi-chart-bar', '/inventory/stock', '사업장과 창고별 재고를 조회합니다.'),
                    makeItem('inventory.movements', '입출고 이력', 'pi pi-fw pi-arrow-right-arrow-left', '/inventory/movements', '모든 재고 이동 이력을 추적합니다.'),
                    makeItem('inventory.items', '품목 관리', 'pi pi-fw pi-tags', '/inventory/items', '품목과 단위, 안전재고를 관리합니다.'),
                    makeItem('inventory.warehouses', '창고 관리', 'pi pi-fw pi-warehouse', '/inventory/warehouses', '창고 및 로케이션을 관리합니다.'),
                    makeItem('logistics.shipments', '출하 관리', 'pi pi-fw pi-send', '/logistics/shipments', '피킹, 패킹 및 출하를 관리합니다.'),
                    makeItem('logistics.returns', '반품 관리', 'pi pi-fw pi-replay', '/logistics/returns', '고객 반품과 판정을 관리합니다.')
                ]
            },
            {
                label: '생산관리',
                icon: 'pi pi-fw pi-cog',
                path: '/production',
                items: [
                    makeItem('production.work-orders', '작업지시', 'pi pi-fw pi-list-check', '/production/work-orders', '생산 작업지시와 실적을 관리합니다.'),
                    makeItem('production.bom', 'BOM 관리', 'pi pi-fw pi-sitemap', '/production/bom', '제품별 자재 명세를 관리합니다.'),
                    makeItem('production.schedule', '생산계획', 'pi pi-fw pi-calendar-clock', '/production/schedule', '생산 능력과 일정을 계획합니다.'),
                    makeItem('production.quality', '품질관리', 'pi pi-fw pi-verified', '/production/quality', '검사 결과와 부적합을 관리합니다.')
                ]
            },
            {
                label: '회계 · 재무',
                icon: 'pi pi-fw pi-wallet',
                path: '/finance',
                items: [
                    makeItem('finance.summary', '재무 현황', 'pi pi-fw pi-chart-pie', '/finance/summary', '자금과 손익 현황을 확인합니다.'),
                    makeItem('finance.ar', '매출채권', 'pi pi-fw pi-arrow-down-left', '/finance/ar', '청구 및 수금 현황을 관리합니다.'),
                    makeItem('finance.ap', '매입채무', 'pi pi-fw pi-arrow-up-right', '/finance/ap', '지급 예정과 매입채무를 관리합니다.'),
                    makeItem('finance.journals', '전표 관리', 'pi pi-fw pi-book', '/finance/journals', '회계 전표를 등록하고 승인합니다.'),
                    makeItem('finance.statements', '재무제표', 'pi pi-fw pi-file', '/finance/statements', '재무제표와 마감 자료를 조회합니다.')
                ]
            }
        ]
    },
    {
        label: '분석 및 관리',
        items: [
            {
                label: '보고서',
                icon: 'pi pi-fw pi-chart-bar',
                path: '/reports',
                items: [
                    makeItem('reports.sales', '영업 분석', 'pi pi-fw pi-chart-line', '/reports/sales', '매출과 수주 성과를 분석합니다.'),
                    makeItem('reports.purchasing', '구매 분석', 'pi pi-fw pi-chart-line', '/reports/purchasing', '구매 단가와 납기 성과를 분석합니다.'),
                    makeItem('reports.inventory', '재고 분석', 'pi pi-fw pi-chart-line', '/reports/inventory', '재고 회전과 장기 재고를 분석합니다.'),
                    makeItem('reports.finance', '재무 분석', 'pi pi-fw pi-chart-line', '/reports/finance', '손익과 현금 흐름을 분석합니다.')
                ]
            },
            {
                label: '기준정보',
                icon: 'pi pi-fw pi-database',
                path: '/master',
                items: [
                    makeItem('master.items', '품목 기준정보', 'pi pi-fw pi-box', '/master/items', '전사 품목 기준정보를 관리합니다.'),
                    makeItem('master.partners', '거래처 기준정보', 'pi pi-fw pi-building', '/master/partners', '고객과 공급처 기준정보를 관리합니다.'),
                    makeItem('master.accounts', '계정과목', 'pi pi-fw pi-list', '/master/accounts', '회계 계정 체계를 관리합니다.')
                ]
            },
            {
                label: '시스템',
                icon: 'pi pi-fw pi-cog',
                path: '/settings',
                items: [
                    makeItem('settings.company', '회사 · 사업장', 'pi pi-fw pi-building-columns', '/settings/company', '회사와 사업장 정보를 관리합니다.'),
                    makeItem('settings.accounts', '계정 관리', 'pi pi-fw pi-users', '/settings/accounts', 'ERP 사용자 계정을 관리합니다.'),
                    makeItem('settings.menu-permissions', '메뉴 권한 관리', 'pi pi-fw pi-shield', '/settings/menu-permissions', '역할별 메뉴 접근 권한을 관리합니다.'),
                    makeItem('settings.infrastructure-usage', '인프라 사용량', 'pi pi-fw pi-server', '/settings/infrastructure-usage', '서비스 상태와 호출량을 확인합니다.'),
                    makeItem('settings.audit', '감사 로그', 'pi pi-fw pi-history', '/settings/audit', '주요 변경과 접근 이력을 조회합니다.')
                ]
            }
        ]
    }
];

export function flattenMenuRoutes(items) {
    return items.flatMap((item) => {
        const current = item.to ? [item] : [];
        return item.items ? current.concat(flattenMenuRoutes(item.items)) : current;
    });
}

export function filterMenuByAccess(items, canAccess) {
    return items.flatMap((item) => {
        if (!item.items) return item.menuKey && canAccess(item.menuKey) ? [item] : [];

        const visibleItems = filterMenuByAccess(item.items, canAccess);
        return visibleItems.length ? [{ ...item, items: visibleItems }] : [];
    });
}

export function getMenuParentPath(path) {
    const findParentPath = (items, parentPath = null) => {
        for (const item of items) {
            if (item.to === path) return parentPath;

            if (item.items) {
                const itemPath = item.path ? `${parentPath || ''}${item.path}` : parentPath;
                const match = findParentPath(item.items, itemPath);
                if (match !== undefined) return match;
            }
        }

        return undefined;
    };

    return findParentPath(erpMenu) ?? null;
}

const moduleByPath = Object.fromEntries(flattenMenuRoutes(erpMenu).map((item) => [item.to, { title: item.label, description: item.description, icon: item.icon }]));

export function getModuleDefinition(path) {
    return moduleByPath[path] || { title: '업무 화면', description: 'ERP 업무 데이터를 조회하고 관리합니다.', icon: 'pi pi-briefcase' };
}

export function formatWon(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000_000) return `₩${(value / 1_000_000_000).toFixed(1)}B`;
    if (absolute >= 1_000_000) return `₩${(value / 1_000_000).toFixed(1)}M`;
    return `₩${value.toLocaleString('ko-KR')}`;
}

// Only these application roles may approve or reject a request. Menu permissions decide who can view the inbox.
export const APPROVAL_DECISION_ROLES = Object.freeze(['admin', 'approver']);

export function canDecideApprovals(role) {
    return APPROVAL_DECISION_ROLES.includes(role);
}

export function validateOrderDraft(order = {}) {
    const errors = {
        customer: typeof order.customer !== 'string' || !order.customer.trim(),
        orderDate: !order.orderDate,
        dueDate: !order.dueDate || Boolean(order.orderDate && order.dueDate < order.orderDate),
        amount: !Number.isFinite(Number(order.amount)) || Number(order.amount) <= 0
    };

    return { errors, isValid: !Object.values(errors).some(Boolean) };
}

export function nextOrderNumber(orders, orderDate) {
    const dateToken = orderDate.replaceAll('-', '').slice(2);
    const prefix = `SO-${dateToken}-`;
    const currentSequence = orders.reduce((highest, order) => {
        if (!order.number?.startsWith(prefix)) return highest;
        const sequence = Number.parseInt(order.number.slice(prefix.length), 10);
        return Number.isNaN(sequence) ? highest : Math.max(highest, sequence);
    }, 0);

    return `${prefix}${String(currentSequence + 1).padStart(3, '0')}`;
}

const periodFactor = { '이번 주': 0.27, '이번 달': 1, '이번 분기': 2.86 };
const companyFactor = { '전체 회사': 1, '넥서스 제조': 0.64, '넥서스 유통': 0.36 };
const siteFactor = { '전체 사업장': 1, '서울 본사': 0.46, '인천 공장': 0.34, '부산 물류센터': 0.2 };

export function getDashboardSnapshot({ company = '전체 회사', site = '전체 사업장', period = '이번 달' } = {}) {
    const factor = (periodFactor[period] || 1) * (companyFactor[company] || 1) * (siteFactor[site] || 1);
    const orderCount = Math.round(42 * factor);
    const sales = Math.round(534_200_000 * factor);
    const receivables = Math.round(87_400_000 * Math.max(factor, 0.4));
    const shortages = Math.max(2, Math.round(18 * Math.sqrt(factor)));
    const salesTrend = [312, 356, 408, 382, 476, 534].map((value) => Math.round(value * factor));
    const purchaseTrend = [238, 274, 302, 298, 341, 368].map((value) => Math.round(value * factor));

    return {
        metrics: [
            { label: '금일 수주', rawValue: orderCount, value: `${orderCount}건`, delta: '+12%', note: '전일 대비', icon: 'pi-shopping-cart', tone: 'blue' },
            { label: '매출 실적', rawValue: sales, value: formatWon(sales), delta: '78%', note: '목표 달성률', icon: 'pi-chart-line', tone: 'orange' },
            { label: '미수금', rawValue: receivables, value: formatWon(receivables), delta: '6건', note: '연체 채권', icon: 'pi-wallet', tone: 'cyan' },
            { label: '재고 부족', rawValue: shortages, value: `${shortages}품목`, delta: '4품목', note: '긴급 발주', icon: 'pi-exclamation-triangle', tone: 'purple' }
        ],
        trend: { labels: ['4월', '5월', '6월', '7월', '8월', '9월'], sales: salesTrend, purchases: purchaseTrend }
    };
}

export const orderRows = [
    { id: 1, number: 'SO-260911-042', customer: '세림유통', owner: '김서준', orderDate: '2026-09-11', dueDate: '2026-09-18', amount: 8420000, status: ORDER_STATUS.APPROVED },
    { id: 2, number: 'SO-260911-041', customer: '한빛테크', owner: '박지민', orderDate: '2026-09-11', dueDate: '2026-09-16', amount: 3180000, status: ORDER_STATUS.IN_REVIEW },
    { id: 3, number: 'SO-260910-038', customer: '미래상사', owner: '이현우', orderDate: '2026-09-10', dueDate: '2026-09-15', amount: 12700000, status: ORDER_STATUS.AWAITING_SHIPMENT },
    { id: 4, number: 'SO-260910-036', customer: '정우산업', owner: '최유진', orderDate: '2026-09-10', dueDate: '2026-09-12', amount: 1950000, status: ORDER_STATUS.OVERDUE },
    { id: 5, number: 'SO-260909-031', customer: '다온솔루션', owner: '김서준', orderDate: '2026-09-09', dueDate: '2026-09-20', amount: 6240000, status: ORDER_STATUS.PENDING_APPROVAL },
    { id: 6, number: 'SO-260909-029', customer: '가온전자', owner: '박지민', orderDate: '2026-09-09', dueDate: '2026-09-19', amount: 4560000, status: ORDER_STATUS.APPROVED },
    { id: 7, number: 'SO-260908-026', customer: '태산기공', owner: '이현우', orderDate: '2026-09-08', dueDate: '2026-09-17', amount: 9880000, status: ORDER_STATUS.IN_REVIEW },
    { id: 8, number: 'SO-260908-024', customer: '새롬물산', owner: '최유진', orderDate: '2026-09-08', dueDate: '2026-09-14', amount: 2730000, status: ORDER_STATUS.ON_HOLD }
];

export const inventoryRows = [
    { code: 'RM-AL-001', name: '알루미늄 시트 2T', warehouse: '인천 원자재창고', stock: 84, safety: 120, unit: 'EA', status: STOCK_STATUS.LOW },
    { code: 'RM-ST-014', name: '스테인리스 파이프', warehouse: '인천 원자재창고', stock: 214, safety: 180, unit: 'EA', status: STOCK_STATUS.NORMAL },
    { code: 'FG-MD-220', name: '모터 드라이브 220V', warehouse: '부산 완제품창고', stock: 12, safety: 32, unit: 'EA', status: STOCK_STATUS.CRITICAL },
    { code: 'PK-BX-008', name: '수출 포장 박스 L', warehouse: '부산 부자재창고', stock: 460, safety: 300, unit: 'EA', status: STOCK_STATUS.NORMAL },
    { code: 'FG-CT-450', name: '제어반 CT-450', warehouse: '인천 완제품창고', stock: 27, safety: 24, unit: 'EA', status: STOCK_STATUS.NORMAL }
];

export const approvalRows = [
    { id: 'AP-260911-18', type: '구매 발주', title: '인천공장 원자재 긴급 발주', requester: '오민재', requestedAt: '2026-09-11 10:24', amount: 18400000, status: APPROVAL_STATUS.PENDING },
    { id: 'AP-260911-17', type: '매출 할인', title: '세림유통 특별 할인율 적용', requester: '김서준', requestedAt: '2026-09-11 09:48', amount: 8420000, status: APPROVAL_STATUS.IN_REVIEW },
    { id: 'AP-260910-52', type: '비용 전표', title: '부산 물류센터 운송비 정산', requester: '윤하늘', requestedAt: '2026-09-10 17:12', amount: 2650000, status: APPROVAL_STATUS.PENDING }
];
