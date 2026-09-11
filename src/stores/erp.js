import { approvalRows, nextOrderNumber, orderRows } from '@/data/erp';
import { computed, ref } from 'vue';

const cloneApprovals = () => approvalRows.map((approval) => ({ ...approval }));
const approvals = ref(cloneApprovals());
const cloneOrders = () => orderRows.map((order) => ({ ...order }));
const orders = ref(cloneOrders());
const genericRecords = ref({});
let nextOrderId = Math.max(...orderRows.map((order) => order.id), 0) + 1;
let issuedOrderNumbers = new Set(orderRows.map((order) => order.number));
const isPendingApproval = (approval) => approval.status === '승인 대기' || approval.status === '검토 중';
const pendingApprovals = computed(() => approvals.value.filter(isPendingApproval));
const pendingApprovalCount = computed(() => pendingApprovals.value.length);
const recentOrders = computed(() => orders.value.slice(0, 5));

function updateApprovalStatus(id, status) {
    const approval = approvals.value.find((item) => item.id === id);
    if (approval) approval.status = status;
}

function addOrder(order) {
    const issuedOrders = [...issuedOrderNumbers].map((number) => ({ number }));
    const created = {
        id: nextOrderId++,
        number: nextOrderNumber(issuedOrders, order.orderDate),
        ...order
    };
    issuedOrderNumbers.add(created.number);
    orders.value.unshift(created);
    return created;
}

function deleteOrder(id) {
    orders.value = orders.value.filter((order) => order.id !== id);
}

function getGenericRecords(path) {
    return genericRecords.value[path] || [];
}

function addGenericRecord(path, record) {
    genericRecords.value = {
        ...genericRecords.value,
        [path]: [record, ...getGenericRecords(path)]
    };
}

function resetDemoState() {
    approvals.value = cloneApprovals();
    orders.value = cloneOrders();
    genericRecords.value = {};
    nextOrderId = Math.max(...orderRows.map((order) => order.id), 0) + 1;
    issuedOrderNumbers = new Set(orderRows.map((order) => order.number));
}

export function useErpStore() {
    return {
        approvals,
        pendingApprovals,
        pendingApprovalCount,
        orders,
        recentOrders,
        isPendingApproval,
        updateApprovalStatus,
        addOrder,
        deleteOrder,
        genericRecords,
        getGenericRecords,
        addGenericRecord,
        resetDemoState
    };
}
