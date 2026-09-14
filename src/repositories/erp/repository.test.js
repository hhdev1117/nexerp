import { approvalRows, orderRows } from '@/data/erp';
import { APPROVAL_STATUS, ORDER_STATUS, TASK_STATUS } from '@/data/status';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoErpRepository } from './demoErpRepository';
import { ERP_REPOSITORY_METHODS, getErpRepository, resetErpRepository, setErpRepository } from './index';

const orderDraft = { customer: '테스트상사', owner: '김서준', orderDate: '2026-09-11', dueDate: '2026-09-18', amount: 5000000, status: ORDER_STATUS.PENDING_APPROVAL };

afterEach(() => {
    resetErpRepository();
});

describe('demo ERP repository', () => {
    it('returns fresh cloned order and approval records', async () => {
        const repository = createDemoErpRepository();
        const orders = await repository.listOrders();
        const approvals = await repository.listApprovals();

        orders[0].customer = 'mutated';
        orders.push({ id: 999 });
        approvals[0].status = 'mutated';

        expect(await repository.listOrders()).toEqual(orderRows);
        expect(await repository.listApprovals()).toEqual(approvalRows);
        expect(await repository.listOrders()).not.toBe(orders);
        expect(orderRows[0].customer).toBe('세림유통');
    });

    it('assigns server-side identifiers and document numbers when creating orders', async () => {
        const repository = createDemoErpRepository();
        const created = await repository.createOrder({ ...orderDraft, id: 1, number: 'SO-OVERRIDE' });

        expect(created).toEqual({ ...orderDraft, id: 9, number: 'SO-260911-043' });
        const listed = await repository.listOrders();
        expect(listed[0]).toEqual(created);
        expect(listed[0]).not.toBe(created);
        expect(orderRows).toHaveLength(8);

        await repository.deleteOrder(created.id);
        const recreated = await repository.createOrder(orderDraft);
        expect(recreated.number).toBe('SO-260911-044');
        expect(recreated.id).toBe(10);
        expect((await repository.listOrders()).some((order) => order.id === created.id)).toBe(false);
    });

    it('updates orders without changing their identity', async () => {
        const repository = createDemoErpRepository();
        const updated = await repository.updateOrder(1, { amount: 1, status: ORDER_STATUS.AWAITING_SHIPMENT, id: 77, number: 'SO-X' });

        expect(updated).toMatchObject({ id: 1, number: 'SO-260911-042', amount: 1, status: ORDER_STATUS.AWAITING_SHIPMENT });
        expect((await repository.listOrders()).find((order) => order.id === 1)).toEqual(updated);
        expect(orderRows[0].amount).toBe(8420000);
    });

    it('reports missing records with a stable not_found code', async () => {
        const repository = createDemoErpRepository();

        await expect(repository.updateOrder(999, { amount: 1 })).rejects.toMatchObject({ name: 'ErpRepositoryError', code: 'not_found' });
        await expect(repository.deleteOrder(999)).rejects.toMatchObject({ code: 'not_found' });
        await expect(repository.updateApprovalStatus('AP-NONE', APPROVAL_STATUS.APPROVED)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('persists approval decisions in its own state', async () => {
        const repository = createDemoErpRepository();
        const updated = await repository.updateApprovalStatus('AP-260911-18', APPROVAL_STATUS.APPROVED);

        expect(updated.status).toBe(APPROVAL_STATUS.APPROVED);
        expect((await repository.listApprovals()).find((approval) => approval.id === 'AP-260911-18').status).toBe(APPROVAL_STATUS.APPROVED);
        expect(approvalRows.find((approval) => approval.id === 'AP-260911-18').status).toBe(APPROVAL_STATUS.PENDING);
    });

    it('returns isolated fresh arrays for route-specific generic records', async () => {
        const repository = createDemoErpRepository();
        const quotes = await repository.listGenericRecords('/sales/quotes');

        quotes.push({ id: 'mutated' });

        expect(await repository.listGenericRecords('/sales/quotes')).toEqual([]);
        expect(await repository.listGenericRecords('/purchasing/orders')).toEqual([]);
        expect(await repository.listGenericRecords('/sales/quotes')).not.toBe(await repository.listGenericRecords('/sales/quotes'));
    });

    it('numbers generic records by module prefix and stamps the creation time', async () => {
        const repository = createDemoErpRepository({ now: () => new Date(2026, 8, 14, 9, 5) });
        const created = await repository.createGenericRecord('/sales/quotes', { subject: '신규 견적', owner: '김서준', status: TASK_STATUS.IN_PROGRESS, id: 'ignored' });
        const second = await repository.createGenericRecord('/sales/quotes', { subject: '두 번째 견적', owner: '박지민', status: TASK_STATUS.PENDING_APPROVAL });
        const other = await repository.createGenericRecord('/purchasing/orders', { subject: '발주', owner: '이현우', status: TASK_STATUS.IN_PROGRESS });

        expect(created).toEqual({ id: 'SA-QU-260914-N01', subject: '신규 견적', owner: '김서준', status: TASK_STATUS.IN_PROGRESS, updatedAt: '2026-09-14 09:05' });
        expect(second.id).toBe('SA-QU-260914-N02');
        expect(other.id).toBe('PU-OR-260914-N01');
        expect(await repository.listGenericRecords('/sales/quotes')).toEqual([second, created]);
        expect(await repository.listGenericRecords('/purchasing/orders')).toEqual([other]);
    });

    it('seeds custom data without exposing the seed arrays', async () => {
        const seededOrders = [{ id: 40, number: 'SO-260912-007', customer: '저장소상사', status: ORDER_STATUS.PENDING_APPROVAL }];
        const seededQuotes = [{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }];
        const repository = createDemoErpRepository({ orders: seededOrders, approvals: [], genericRecords: { '/sales/quotes': seededQuotes } });

        seededOrders[0].customer = 'mutated';
        seededQuotes[0].subject = 'mutated';

        expect(await repository.listOrders()).toEqual([{ id: 40, number: 'SO-260912-007', customer: '저장소상사', status: ORDER_STATUS.PENDING_APPROVAL }]);
        expect(await repository.listApprovals()).toEqual([]);
        expect(await repository.listGenericRecords('/sales/quotes')).toEqual([{ id: 'QUOTE-CUSTOM', subject: '저장소 견적' }]);
        const created = await repository.createOrder({ ...orderDraft, orderDate: '2026-09-12' });
        expect(created).toMatchObject({ id: 41, number: 'SO-260912-008' });
    });
});

describe('ERP repository selection', () => {
    it('declares the complete asynchronous read and write contract', () => {
        expect(ERP_REPOSITORY_METHODS).toEqual(['listOrders', 'createOrder', 'updateOrder', 'deleteOrder', 'listApprovals', 'updateApprovalStatus', 'listGenericRecords', 'createGenericRecord']);
        for (const method of ERP_REPOSITORY_METHODS) expect(createDemoErpRepository()[method]).toEqual(expect.any(Function));
    });

    it('uses a selected repository until it is reset', () => {
        const repository = Object.fromEntries(ERP_REPOSITORY_METHODS.map((method) => [method, async () => []]));

        setErpRepository(repository);
        expect(getErpRepository()).toBe(repository);

        resetErpRepository();
        expect(getErpRepository()).not.toBe(repository);
        for (const method of ERP_REPOSITORY_METHODS) expect(getErpRepository()[method]).toEqual(expect.any(Function));
    });

    it.each([null, {}, { listOrders() {} }, { listOrders() {}, listApprovals() {}, listGenericRecords() {} }])('rejects an incomplete repository without business data in the error %#', (repository) => {
        const sensitiveValue = 'customer-secret-value';
        if (repository) repository.businessData = sensitiveValue;

        expect(() => setErpRepository(repository)).toThrow(TypeError);
        try {
            setErpRepository(repository);
        } catch (error) {
            expect(error.message).toContain('listOrders, createOrder, updateOrder, deleteOrder, listApprovals, updateApprovalStatus, listGenericRecords, and createGenericRecord');
            expect(error.message).not.toContain(sensitiveValue);
        }
    });
});
