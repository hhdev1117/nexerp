import { describe, expect, it } from 'vitest';
import { useErpStore } from './erp';

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

    it('keeps generic records isolated by route and available after navigation', () => {
        const store = useErpStore();
        store.resetDemoState();
        const quote = { id: 'SA-QU-260911-N01', subject: '신규 견적', owner: '김서준', updatedAt: '2026-09-11 13:00', status: '진행중' };

        store.addGenericRecord('/sales/quotes', quote);

        expect(store.getGenericRecords('/sales/quotes')).toEqual([quote]);
        expect(store.getGenericRecords('/purchasing/orders')).toEqual([]);

        store.resetDemoState();
    });
});
