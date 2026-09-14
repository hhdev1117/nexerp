import { assertTransition, isPendingApprovalStatus } from '@/data/status';
import { getErpRepository } from '@/repositories/erp';
import { computed, ref } from 'vue';

const LOAD_FAILURE_MESSAGE = '업무 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
const EMPTY_RECORDS = Object.freeze([]);
const cloneRows = (rows) => rows.map((row) => ({ ...row }));

const approvals = ref([]);
const orders = ref([]);
const genericRecords = ref({});
const loading = ref(false);
const error = ref(null);
const genericLoads = new Map();
let loadPromise = null;
let loadSequence = 0;

const isPendingApproval = (approval) => isPendingApprovalStatus(approval?.status);
const pendingApprovals = computed(() => approvals.value.filter(isPendingApproval));
const pendingApprovalCount = computed(() => pendingApprovals.value.length);
const recentOrders = computed(() => orders.value.slice(0, 5));

const notFound = (message) => {
    const failure = new Error(message);
    failure.name = 'ErpStoreError';
    failure.code = 'not_found';
    return failure;
};

async function load() {
    const sequence = ++loadSequence;
    const repository = getErpRepository();
    loading.value = true;
    try {
        const [nextOrders, nextApprovals] = await Promise.all([repository.listOrders(), repository.listApprovals()]);
        if (sequence !== loadSequence) return;
        orders.value = cloneRows(nextOrders);
        approvals.value = cloneRows(nextApprovals);
        genericRecords.value = {};
        genericLoads.clear();
        error.value = null;
    } catch {
        if (sequence === loadSequence) error.value = LOAD_FAILURE_MESSAGE;
    } finally {
        if (sequence === loadSequence) loading.value = false;
    }
}

function ensureLoaded() {
    if (!loadPromise) loadPromise = load();
    return loadPromise;
}

function reload() {
    loadPromise = load();
    return loadPromise;
}

async function updateApprovalStatus(id, status) {
    await ensureLoaded();
    const approval = approvals.value.find((item) => item.id === id);
    if (!approval) throw notFound('결재 요청을 찾을 수 없습니다.');
    assertTransition('approval', approval.status, status);

    const updated = await getErpRepository().updateApprovalStatus(id, status);
    approvals.value = approvals.value.map((item) => (item.id === id ? { ...item, ...updated } : item));
    return { ...approval, ...updated };
}

async function addOrder(draft) {
    await ensureLoaded();
    const created = await getErpRepository().createOrder({ ...draft });
    orders.value = [created, ...orders.value];
    return created;
}

async function updateOrder(id, changes) {
    await ensureLoaded();
    const order = orders.value.find((item) => item.id === id);
    if (!order) throw notFound('수주를 찾을 수 없습니다.');
    if (changes?.status !== undefined && changes.status !== order.status) assertTransition('order', order.status, changes.status);

    const updated = await getErpRepository().updateOrder(id, { ...changes });
    orders.value = orders.value.map((item) => (item.id === id ? { ...item, ...updated } : item));
    return { ...order, ...updated };
}

async function deleteOrder(id) {
    await ensureLoaded();
    await getErpRepository().deleteOrder(id);
    orders.value = orders.value.filter((order) => order.id !== id);
}

function getGenericRecords(path) {
    return genericRecords.value[path] || EMPTY_RECORDS;
}

async function ensureGenericRecords(path) {
    await ensureLoaded();
    if (Object.hasOwn(genericRecords.value, path)) return genericRecords.value[path];
    if (genericLoads.has(path)) return genericLoads.get(path);

    const request = (async () => {
        try {
            const rows = await getErpRepository().listGenericRecords(path);
            genericRecords.value = { ...genericRecords.value, [path]: cloneRows(rows) };
            return genericRecords.value[path];
        } catch {
            error.value = LOAD_FAILURE_MESSAGE;
            return EMPTY_RECORDS;
        } finally {
            genericLoads.delete(path);
        }
    })();

    genericLoads.set(path, request);
    return request;
}

async function addGenericRecord(path, draft) {
    await ensureGenericRecords(path);
    const created = await getErpRepository().createGenericRecord(path, { ...draft });
    genericRecords.value = { ...genericRecords.value, [path]: [created, ...getGenericRecords(path)] };
    return created;
}

export function useErpStore() {
    ensureLoaded();

    return {
        approvals,
        pendingApprovals,
        pendingApprovalCount,
        orders,
        recentOrders,
        loading,
        error,
        isPendingApproval,
        ensureLoaded,
        reload,
        resetDemoState: reload,
        updateApprovalStatus,
        addOrder,
        updateOrder,
        deleteOrder,
        genericRecords,
        getGenericRecords,
        ensureGenericRecords,
        addGenericRecord
    };
}
