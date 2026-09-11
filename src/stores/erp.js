import { nextOrderNumber } from '@/data/erp';
import { getErpRepository } from '@/repositories/erp';
import { computed, ref } from 'vue';

const cloneRows = (rows) => rows.map((row) => ({ ...row }));
const initialRepository = getErpRepository();
const approvals = ref(cloneRows(initialRepository.listApprovals()));
const orders = ref(cloneRows(initialRepository.listOrders()));
const genericRecords = ref({});
const getNextOrderId = (rows) => rows.reduce((highest, order) => (Number.isInteger(order.id) ? Math.max(highest, order.id) : highest), 0) + 1;
let nextOrderId = getNextOrderId(orders.value);
let issuedOrderNumbers = new Set(orders.value.map((order) => order.number));
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
        ...order,
        id: nextOrderId++,
        number: nextOrderNumber(issuedOrders, order.orderDate)
    };
    issuedOrderNumbers.add(created.number);
    orders.value.unshift(created);
    return created;
}

function deleteOrder(id) {
    orders.value = orders.value.filter((order) => order.id !== id);
}

function getGenericRecords(path) {
    if (!Object.hasOwn(genericRecords.value, path)) {
        genericRecords.value = {
            ...genericRecords.value,
            [path]: cloneRows(getErpRepository().listGenericRecords(path))
        };
    }
    return genericRecords.value[path];
}

function addGenericRecord(path, record) {
    genericRecords.value = {
        ...genericRecords.value,
        [path]: [record, ...getGenericRecords(path)]
    };
}

function resetDemoState() {
    const repository = getErpRepository();
    approvals.value = cloneRows(repository.listApprovals());
    orders.value = cloneRows(repository.listOrders());
    genericRecords.value = {};
    nextOrderId = getNextOrderId(orders.value);
    issuedOrderNumbers = new Set(orders.value.map((order) => order.number));
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
