import { approvalRows, orderRows } from '@/data/erp';

const cloneRows = (rows) => rows.map((row) => ({ ...row }));

export function createDemoErpRepository() {
    return {
        listOrders: () => cloneRows(orderRows),
        listApprovals: () => cloneRows(approvalRows),
        listGenericRecords: () => []
    };
}
