import { approvalRows, nextOrderNumber, orderRows } from '@/data/erp';

const cloneRows = (rows) => rows.map((row) => ({ ...row }));

const notFound = (message) => {
    const error = new Error(message);
    error.name = 'ErpRepositoryError';
    error.code = 'not_found';
    return error;
};

const withoutIdentity = (fields) => {
    const draft = { ...fields };
    delete draft.id;
    delete draft.number;
    return draft;
};

const localDate = (date) => date.toLocaleDateString('sv-SE');
const localTime = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const modulePrefix = (path) =>
    path
        .split('/')
        .filter(Boolean)
        .map((part) => part.slice(0, 2).toUpperCase())
        .join('-');

// In-memory implementation of the ERP repository contract. It owns identifiers, document numbers,
// and timestamps the way a server would, so the store and screens never fabricate them.
export function createDemoErpRepository({ orders = orderRows, approvals = approvalRows, genericRecords = {}, now = () => new Date() } = {}) {
    let orderState = cloneRows(orders);
    const approvalState = cloneRows(approvals);
    const genericState = Object.fromEntries(Object.entries(genericRecords).map(([path, rows]) => [path, cloneRows(rows)]));
    let nextOrderId = orderState.reduce((highest, order) => (Number.isInteger(order.id) ? Math.max(highest, order.id) : highest), 0) + 1;
    const issuedOrderNumbers = new Set(orderState.map((order) => order.number));

    const findOrder = (id) => orderState.find((order) => order.id === id);

    return {
        async listOrders() {
            return cloneRows(orderState);
        },

        async createOrder(draft) {
            const fields = withoutIdentity(draft);
            const issued = [...issuedOrderNumbers].map((number) => ({ number }));
            const created = { ...fields, id: nextOrderId++, number: nextOrderNumber(issued, fields.orderDate) };
            issuedOrderNumbers.add(created.number);
            orderState.unshift(created);
            return { ...created };
        },

        async updateOrder(id, changes) {
            const order = findOrder(id);
            if (!order) throw notFound('수주를 찾을 수 없습니다.');
            Object.assign(order, withoutIdentity(changes));
            return { ...order };
        },

        async deleteOrder(id) {
            if (!findOrder(id)) throw notFound('수주를 찾을 수 없습니다.');
            orderState = orderState.filter((order) => order.id !== id);
        },

        async listApprovals() {
            return cloneRows(approvalState);
        },

        async updateApprovalStatus(id, status) {
            const approval = approvalState.find((item) => item.id === id);
            if (!approval) throw notFound('결재 요청을 찾을 수 없습니다.');
            approval.status = status;
            return { ...approval };
        },

        async listGenericRecords(path) {
            return cloneRows(genericState[path] || []);
        },

        async createGenericRecord(path, draft) {
            const rows = genericState[path] || (genericState[path] = []);
            const timestamp = now();
            const date = localDate(timestamp);
            const created = {
                ...withoutIdentity(draft),
                id: `${modulePrefix(path)}-${date.replaceAll('-', '').slice(2)}-N${String(rows.length + 1).padStart(2, '0')}`,
                updatedAt: `${date} ${localTime(timestamp)}`
            };
            rows.unshift(created);
            return { ...created };
        }
    };
}
