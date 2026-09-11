import { approvalRows, orderRows } from '@/data/erp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoErpRepository } from './demoErpRepository';
import { getErpRepository, resetErpRepository, setErpRepository } from './index';

afterEach(() => {
    resetErpRepository();
});

describe('demo ERP repository', () => {
    it('returns fresh cloned order and approval records', () => {
        const repository = createDemoErpRepository();
        const orders = repository.listOrders();
        const approvals = repository.listApprovals();

        orders[0].customer = 'mutated';
        orders.push({ id: 999 });
        approvals[0].status = 'mutated';

        expect(repository.listOrders()).toEqual(orderRows);
        expect(repository.listApprovals()).toEqual(approvalRows);
        expect(repository.listOrders()).not.toBe(orders);
        expect(repository.listApprovals()).not.toBe(approvals);
    });

    it('returns isolated fresh arrays for route-specific generic records', () => {
        const repository = createDemoErpRepository();
        const quotes = repository.listGenericRecords('/sales/quotes');

        quotes.push({ id: 'mutated' });

        expect(repository.listGenericRecords('/sales/quotes')).toEqual([]);
        expect(repository.listGenericRecords('/purchasing/orders')).toEqual([]);
        expect(repository.listGenericRecords('/sales/quotes')).not.toBe(repository.listGenericRecords('/sales/quotes'));
    });
});

describe('ERP repository selection', () => {
    it('uses a selected repository until it is reset', () => {
        const repository = {
            listOrders: () => [],
            listApprovals: () => [],
            listGenericRecords: () => []
        };

        setErpRepository(repository);
        expect(getErpRepository()).toBe(repository);

        resetErpRepository();
        expect(getErpRepository()).not.toBe(repository);
        expect(getErpRepository()).toEqual(
            expect.objectContaining({
                listOrders: expect.any(Function),
                listApprovals: expect.any(Function),
                listGenericRecords: expect.any(Function)
            })
        );
    });

    it.each([null, {}, { listOrders() {} }, { listOrders() {}, listApprovals() {} }])('rejects an invalid repository without business data in the error %#', (repository) => {
        const sensitiveValue = 'customer-secret-value';
        if (repository) repository.businessData = sensitiveValue;

        expect(() => setErpRepository(repository)).toThrow(TypeError);
        try {
            setErpRepository(repository);
        } catch (error) {
            expect(error.message).toContain('listOrders, listApprovals, and listGenericRecords');
            expect(error.message).not.toContain(sensitiveValue);
        }
    });
});
