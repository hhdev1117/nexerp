import { APPROVAL_STATUS, ORDER_STATUS, TASK_STATUS } from '@/data/status';
import { ERP_REPOSITORY_METHODS, getErpRepository, resetErpRepository, setErpRepository } from '@/repositories/erp';
import { createDemoErpRepository } from '@/repositories/erp/demoErpRepository';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useErpStore } from './erp';

const orderDraft = (overrides = {}) => ({ customer: '공유상사', owner: '김서준', orderDate: '2026-09-11', dueDate: '2026-09-18', amount: 5000000, status: ORDER_STATUS.PENDING_APPROVAL, ...overrides });

const mockRepository = () => Object.fromEntries(ERP_REPOSITORY_METHODS.map((method) => [method, vi.fn()]));

afterEach(async () => {
    resetErpRepository();
    await useErpStore().resetDemoState();
});

describe('shared ERP state', () => {
    it('updates pending approvals consistently across consumers', async () => {
        const store = useErpStore();
        await store.resetDemoState();
        const firstId = store.pendingApprovals.value[0].id;

        expect(store.pendingApprovalCount.value).toBe(3);
        await store.updateApprovalStatus(firstId, APPROVAL_STATUS.APPROVED);
        expect(store.pendingApprovalCount.value).toBe(2);
        expect(store.pendingApprovals.value.some((approval) => approval.id === firstId)).toBe(false);
        expect(store.approvals.value.find((approval) => approval.id === firstId).status).toBe(APPROVAL_STATUS.APPROVED);
    });

    it('refuses forbidden approval transitions before touching the repository', async () => {
        const store = useErpStore();
        await store.resetDemoState();
        const [first] = store.pendingApprovals.value;
        await store.updateApprovalStatus(first.id, APPROVAL_STATUS.REJECTED);
        const repositoryUpdate = vi.spyOn(getErpRepository(), 'updateApprovalStatus');

        await expect(store.updateApprovalStatus(first.id, APPROVAL_STATUS.APPROVED)).rejects.toMatchObject({ code: 'invalid_status_transition' });
        expect(repositoryUpdate).not.toHaveBeenCalled();
        expect(store.approvals.value.find((approval) => approval.id === first.id).status).toBe(APPROVAL_STATUS.REJECTED);
        await expect(store.updateApprovalStatus('AP-NONE', APPROVAL_STATUS.APPROVED)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('shares created and deleted orders with dashboard consumers', async () => {
        const store = useErpStore();
        await store.resetDemoState();
        const created = await store.addOrder(orderDraft());

        expect(created.number).toBe('SO-260911-043');
        expect(store.recentOrders.value[0].customer).toBe('공유상사');
        await store.deleteOrder(created.id);
        expect(store.orders.value.some((order) => order.id === created.id)).toBe(false);

        const recreated = await store.addOrder(orderDraft({ customer: '재등록상사', dueDate: '2026-09-19', amount: 6000000 }));
        expect(recreated.number).toBe('SO-260911-044');
        expect(recreated.id).not.toBe(created.id);
    });

    it('always assigns unique monotonic runtime identifiers', async () => {
        const store = useErpStore();
        await store.resetDemoState();
        const created = await store.addOrder(orderDraft({ id: 1, number: 'SO-OVERRIDE', customer: '식별자상사' }));

        expect(created.id).toBe(9);
        expect(created.number).toBe('SO-260911-043');
    });

    it('updates orders through the repository and validates status transitions', async () => {
        const store = useErpStore();
        await store.resetDemoState();

        const updated = await store.updateOrder(5, { amount: 7000000, status: ORDER_STATUS.APPROVED });
        expect(updated).toMatchObject({ id: 5, number: 'SO-260909-031', amount: 7000000, status: ORDER_STATUS.APPROVED });
        expect(store.orders.value.find((order) => order.id === 5)).toMatchObject({ amount: 7000000, status: ORDER_STATUS.APPROVED });

        await expect(store.updateOrder(5, { status: ORDER_STATUS.PENDING_APPROVAL })).rejects.toMatchObject({ code: 'invalid_status_transition' });
        expect(store.orders.value.find((order) => order.id === 5).status).toBe(ORDER_STATUS.APPROVED);
        await expect(store.updateOrder(999, { amount: 1 })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('keeps generic records isolated by route and available after navigation', async () => {
        const store = useErpStore();
        await store.resetDemoState();

        const created = await store.addGenericRecord('/sales/quotes', { subject: '신규 견적', owner: '김서준', status: TASK_STATUS.IN_PROGRESS });

        expect(created).toMatchObject({ subject: '신규 견적', owner: '김서준', status: TASK_STATUS.IN_PROGRESS });
        expect(created.id).toMatch(/^SA-QU-\d{6}-N01$/);
        expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(store.getGenericRecords('/sales/quotes')).toEqual([created]);
        expect(await store.ensureGenericRecords('/purchasing/orders')).toEqual([]);
        expect(store.getGenericRecords('/purchasing/orders')).toEqual([]);
    });

    it('adopts the selected repository on the next reset without exposing its arrays', async () => {
        const seededOrders = [{ id: 40, number: 'SO-260912-007', customer: '저장소상사', owner: '김서준', orderDate: '2026-09-12', dueDate: '2026-09-20', amount: 7000000, status: ORDER_STATUS.PENDING_APPROVAL }];
        const seededApprovals = [{ id: 'AP-CUSTOM', type: '매출 할인', title: '저장소 승인', requester: '김서준', requestedAt: '2026-09-12 09:00', amount: 7000000, status: APPROVAL_STATUS.IN_REVIEW }];
        const seededQuotes = [{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }];
        setErpRepository(createDemoErpRepository({ orders: seededOrders, approvals: seededApprovals, genericRecords: { '/sales/quotes': seededQuotes } }));
        const store = useErpStore();

        await store.resetDemoState();
        seededOrders[0].customer = 'mutated';
        seededApprovals[0].status = 'mutated';
        seededQuotes[0].subject = 'mutated';

        expect(store.orders.value[0].customer).toBe('저장소상사');
        expect(store.approvals.value[0].status).toBe(APPROVAL_STATUS.IN_REVIEW);
        expect(await store.ensureGenericRecords('/sales/quotes')).toEqual([{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }]);
        expect(store.getGenericRecords('/purchasing/orders')).toEqual([]);

        const created = await store.addOrder(orderDraft({ customer: '후속상사', orderDate: '2026-09-12', dueDate: '2026-09-21', amount: 8000000 }));
        expect(created.id).toBe(41);
        expect(created.number).toBe('SO-260912-008');
    });

    it('delegates every write to the active repository contract with copied drafts', async () => {
        const repository = mockRepository();
        repository.listOrders.mockResolvedValue([{ id: 1, number: 'SO-1', status: ORDER_STATUS.PENDING_APPROVAL }]);
        repository.listApprovals.mockResolvedValue([{ id: 'AP-1', status: APPROVAL_STATUS.PENDING }]);
        repository.listGenericRecords.mockResolvedValue([]);
        repository.createOrder.mockImplementation(async (draft) => ({ ...draft, id: 2, number: 'SO-2' }));
        repository.updateOrder.mockImplementation(async (id, changes) => ({ id, ...changes }));
        repository.deleteOrder.mockResolvedValue(undefined);
        repository.updateApprovalStatus.mockImplementation(async (id, status) => ({ id, status }));
        repository.createGenericRecord.mockImplementation(async (path, draft) => ({ ...draft, id: 'GEN-1', updatedAt: '2026-09-14 09:00' }));
        setErpRepository(repository);
        const store = useErpStore();
        await store.resetDemoState();

        const draft = orderDraft();
        const created = await store.addOrder(draft);
        expect(repository.createOrder).toHaveBeenCalledWith(draft);
        expect(repository.createOrder.mock.calls[0][0]).not.toBe(draft);
        expect(store.orders.value.map((order) => order.id)).toEqual([2, 1]);
        expect(created).toMatchObject({ id: 2, number: 'SO-2' });

        await store.updateOrder(1, { amount: 9 });
        expect(repository.updateOrder).toHaveBeenCalledWith(1, { amount: 9 });
        expect(store.orders.value.find((order) => order.id === 1)).toMatchObject({ id: 1, number: 'SO-1', amount: 9 });

        await store.deleteOrder(1);
        expect(repository.deleteOrder).toHaveBeenCalledWith(1);
        expect(store.orders.value.map((order) => order.id)).toEqual([2]);

        await store.updateApprovalStatus('AP-1', APPROVAL_STATUS.IN_REVIEW);
        expect(repository.updateApprovalStatus).toHaveBeenCalledWith('AP-1', APPROVAL_STATUS.IN_REVIEW);
        expect(store.pendingApprovalCount.value).toBe(1);

        await store.addGenericRecord('/sales/quotes', { subject: '견적' });
        expect(repository.createGenericRecord).toHaveBeenCalledWith('/sales/quotes', { subject: '견적' });
        expect(store.getGenericRecords('/sales/quotes')).toEqual([{ subject: '견적', id: 'GEN-1', updatedAt: '2026-09-14 09:00' }]);
    });

    it('surfaces a stable Korean message when the repository cannot load and keeps prior data', async () => {
        const store = useErpStore();
        await store.resetDemoState();
        const previousOrderCount = store.orders.value.length;
        const failing = mockRepository();
        for (const method of ERP_REPOSITORY_METHODS) failing[method].mockRejectedValue(new Error('sentinel-connection-string'));
        setErpRepository(failing);

        await store.resetDemoState();

        expect(store.error.value).toBe('업무 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('sentinel');
        expect(store.loading.value).toBe(false);
        expect(store.orders.value).toHaveLength(previousOrderCount);
        expect(await store.ensureGenericRecords('/sales/quotes')).toEqual([]);

        resetErpRepository();
        await store.resetDemoState();
        expect(store.error.value).toBeNull();
    });
});
