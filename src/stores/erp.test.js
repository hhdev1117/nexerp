import { afterEach, describe, expect, it } from 'vitest';
import { resetErpRepository, setErpRepository } from '@/repositories/erp';
import { useErpStore } from './erp';

afterEach(() => {
    resetErpRepository();
    useErpStore().resetDemoState();
});

describe('shared ERP state', () => {
    it('updates pending approvals consistently across consumers', () => {
        const store = useErpStore();
        store.resetDemoState();
        const firstId = store.pendingApprovals.value[0].id;

        expect(store.pendingApprovalCount.value).toBe(3);
        store.updateApprovalStatus(firstId, '승인 완료');
        expect(store.pendingApprovalCount.value).toBe(2);
        expect(store.pendingApprovals.value.some((approval) => approval.id === firstId)).toBe(false);

        store.resetDemoState();
    });

    it('shares created and deleted orders with dashboard consumers', () => {
        const store = useErpStore();
        store.resetDemoState();
        const created = store.addOrder({ customer: '공유상사', owner: '김서준', orderDate: '2026-09-11', dueDate: '2026-09-18', amount: 5000000, status: '승인 대기' });

        expect(created.number).toBe('SO-260911-043');
        expect(store.recentOrders.value[0].customer).toBe('공유상사');
        store.deleteOrder(created.id);
        expect(store.orders.value.some((order) => order.id === created.id)).toBe(false);

        const recreated = store.addOrder({ customer: '재등록상사', owner: '김서준', orderDate: '2026-09-11', dueDate: '2026-09-19', amount: 6000000, status: '승인 대기' });
        expect(recreated.number).toBe('SO-260911-044');
        expect(recreated.id).not.toBe(created.id);

        store.resetDemoState();
    });

    it('always assigns unique monotonic runtime identifiers', () => {
        const store = useErpStore();
        store.resetDemoState();
        const created = store.addOrder({
            id: 1,
            number: 'SO-OVERRIDE',
            customer: '식별자상사',
            owner: '김서준',
            orderDate: '2026-09-11',
            dueDate: '2026-09-18',
            amount: 5000000,
            status: '승인 대기'
        });

        expect(created.id).toBe(9);
        expect(created.number).toBe('SO-260911-043');
    });

    it('keeps generic records isolated by route and available after navigation', () => {
        const store = useErpStore();
        store.resetDemoState();
        const quote = { id: 'SA-QU-260911-N01', subject: '신규 견적', owner: '김서준', updatedAt: '2026-09-11 13:00', status: '진행중' };

        store.addGenericRecord('/sales/quotes', quote);

        expect(store.getGenericRecords('/sales/quotes')).toEqual([quote]);
        expect(store.getGenericRecords('/purchasing/orders')).toEqual([]);

        store.resetDemoState();
    });

    it('adopts the selected repository on the next reset without exposing its arrays', () => {
        const seededOrders = [{ id: 40, number: 'SO-260912-007', customer: '저장소상사', owner: '김서준', orderDate: '2026-09-12', dueDate: '2026-09-20', amount: 7000000, status: '승인 대기' }];
        const seededApprovals = [{ id: 'AP-CUSTOM', type: '매출 할인', title: '저장소 승인', requester: '김서준', requestedAt: '2026-09-12 09:00', amount: 7000000, status: '검토 중' }];
        const repository = {
            listOrders: () => seededOrders,
            listApprovals: () => seededApprovals,
            listGenericRecords: (path) => (path === '/sales/quotes' ? [{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }] : [])
        };
        const store = useErpStore();

        setErpRepository(repository);
        store.resetDemoState();
        seededOrders[0].customer = 'mutated';
        seededApprovals[0].status = 'mutated';

        expect(store.orders.value[0].customer).toBe('저장소상사');
        expect(store.approvals.value[0].status).toBe('검토 중');
        expect(store.getGenericRecords('/sales/quotes')).toEqual([{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }]);
        expect(store.getGenericRecords('/purchasing/orders')).toEqual([]);

        const created = store.addOrder({ customer: '후속상사', owner: '김서준', orderDate: '2026-09-12', dueDate: '2026-09-21', amount: 8000000, status: '승인 대기' });
        expect(created.id).toBe(41);
        expect(created.number).toBe('SO-260912-008');
    });
});
