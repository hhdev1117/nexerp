<script setup>
import { formatWon, validateOrderDraft } from '@/data/erp';
import { ORDER_STATUS, statusLabel, statusOptions, statusSeverity } from '@/data/status';
import { useErpStore } from '@/stores/erp';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref } from 'vue';

const confirm = useConfirm();
const toast = useToast();
const { orders, loading, error, addOrder, deleteOrder } = useErpStore();
const keyword = ref('');
const selectedStatus = ref(null);
const orderDialog = ref(false);
const submitted = ref(false);
const saving = ref(false);

const orderStatusOptions = statusOptions('order');
const ownerOptions = ['김서준', '박지민', '이현우', '최유진'];

const emptyOrder = () => ({
    customer: '',
    owner: ownerOptions[0],
    orderDate: '2026-09-11',
    dueDate: '2026-09-18',
    amount: null,
    status: ORDER_STATUS.PENDING_APPROVAL
});

const draft = ref(emptyOrder());
const draftErrors = computed(() => validateOrderDraft(draft.value).errors);

const filteredOrders = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return orders.value.filter((order) => {
        const matchesStatus = !selectedStatus.value || order.status === selectedStatus.value;
        const matchesKeyword = !query || [order.number, order.customer, order.owner, statusLabel(order.status)].some((value) => String(value).toLocaleLowerCase('ko-KR').includes(query));
        return matchesStatus && matchesKeyword;
    });
});

function openNewOrder() {
    draft.value = emptyOrder();
    submitted.value = false;
    orderDialog.value = true;
}

async function saveOrder() {
    submitted.value = true;
    const validation = validateOrderDraft(draft.value);
    if (!validation.isValid) {
        await nextTick();
        const firstErrorId = [
            ['customer', 'customer'],
            ['orderDate', 'order-date'],
            ['dueDate', 'due-date'],
            ['amount', 'amount']
        ].find(([field]) => validation.errors[field])?.[1];
        document.getElementById(firstErrorId)?.focus();
        return;
    }

    saving.value = true;
    try {
        const created = await addOrder(draft.value);
        orderDialog.value = false;
        toast.add({ severity: 'success', summary: '수주 등록 완료', detail: `${created.customer} 수주가 등록되었습니다.`, life: 3000 });
    } catch {
        toast.add({ severity: 'error', summary: '수주 등록 실패', detail: '수주를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
    } finally {
        saving.value = false;
    }
}

function confirmDelete(order) {
    confirm.require({
        message: `${order.number} 수주를 삭제하시겠습니까?`,
        header: '수주 삭제',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: '삭제', severity: 'danger' },
        accept: async () => {
            try {
                await deleteOrder(order.id);
                toast.add({ severity: 'success', summary: '삭제 완료', detail: `${order.number} 수주가 삭제되었습니다.`, life: 3000 });
            } catch {
                toast.add({ severity: 'error', summary: '삭제 실패', detail: '수주를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
            }
        }
    });
}
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">수주 관리</h1>
                <div class="mt-1 text-muted-color">고객 수주부터 승인 및 출하 요청까지 관리합니다.</div>
            </div>
            <Button label="신규 수주" icon="pi pi-plus" @click="openNewOrder" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6">{{ error }}</Message>

        <div class="card">
            <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-col gap-3 sm:flex-row">
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="keyword" placeholder="수주번호, 거래처, 담당자 검색" aria-label="수주 검색" class="w-full sm:w-80" />
                    </IconField>
                    <Select v-model="selectedStatus" :options="orderStatusOptions" optionLabel="label" optionValue="value" placeholder="전체 상태" aria-label="수주 상태 필터" showClear class="w-full sm:w-44" />
                </div>
                <div class="text-sm text-muted-color">
                    총 <strong class="text-color">{{ filteredOrders.length }}</strong
                    >건
                </div>
            </div>

            <DataTable
                :value="filteredOrders"
                dataKey="id"
                :loading="loading"
                paginator
                :rows="5"
                :rowsPerPageOptions="[5, 10, 20]"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
                currentPageReportTemplate="{first} - {last} / {totalRecords}건"
                responsiveLayout="scroll"
                tableStyle="min-width: 68rem"
                :tableProps="{ 'aria-label': '수주 목록' }"
                scrollable
            >
                <template #empty>조건에 맞는 수주가 없습니다.</template>
                <Column field="number" header="수주번호" sortable>
                    <template #body="slotProps">
                        <span class="font-medium text-primary">{{ slotProps.data.number }}</span>
                    </template>
                </Column>
                <Column field="customer" header="거래처" sortable />
                <Column field="owner" header="담당자" sortable />
                <Column field="orderDate" header="수주일" sortable />
                <Column field="dueDate" header="납기일" sortable />
                <Column field="amount" header="수주금액" sortable>
                    <template #body="slotProps">
                        <span class="font-medium">{{ formatWon(slotProps.data.amount) }}</span>
                    </template>
                </Column>
                <Column field="status" header="상태" sortable>
                    <template #body="slotProps">
                        <Tag :value="statusLabel(slotProps.data.status)" :severity="statusSeverity(slotProps.data.status)" />
                    </template>
                </Column>
                <Column header="작업" :exportable="false" frozen alignFrozen="right" style="width: 6rem">
                    <template #body="slotProps">
                        <Button icon="pi pi-trash" text rounded severity="danger" :aria-label="`${slotProps.data.number} 수주 삭제`" :title="`${slotProps.data.number} 수주 삭제`" @click="confirmDelete(slotProps.data)" />
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="orderDialog" modal header="신규 수주 등록" :style="{ width: '34rem' }" :breakpoints="{ '640px': '92vw' }">
            <div class="grid grid-cols-12 gap-4">
                <div class="col-span-12">
                    <label for="customer" class="block mb-2 font-medium">거래처</label>
                    <InputText id="customer" v-model.trim="draft.customer" fluid autofocus required aria-describedby="customer-error" :invalid="submitted && draftErrors.customer" placeholder="거래처명을 입력하세요" />
                    <small v-if="submitted && draftErrors.customer" id="customer-error" class="text-red-700 dark:text-red-400" role="alert">거래처는 필수입니다.</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="owner-label" for="owner" class="block mb-2 font-medium">담당자</label>
                    <Select inputId="owner" v-model="draft.owner" :options="ownerOptions" aria-labelledby="owner-label" fluid />
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="order-status-label" for="order-status" class="block mb-2 font-medium">상태</label>
                    <Select inputId="order-status" v-model="draft.status" :options="orderStatusOptions" optionLabel="label" optionValue="value" aria-labelledby="order-status-label" fluid />
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="order-date" class="block mb-2 font-medium">수주일</label>
                    <InputText id="order-date" v-model="draft.orderDate" type="date" fluid required aria-describedby="order-date-error" :invalid="submitted && draftErrors.orderDate" />
                    <small v-if="submitted && draftErrors.orderDate" id="order-date-error" class="text-red-700 dark:text-red-400" role="alert">수주일을 입력하세요.</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="due-date" class="block mb-2 font-medium">납기일</label>
                    <InputText id="due-date" v-model="draft.dueDate" type="date" fluid required aria-describedby="due-date-error" :invalid="submitted && draftErrors.dueDate" />
                    <small v-if="submitted && draftErrors.dueDate" id="due-date-error" class="text-red-700 dark:text-red-400" role="alert">납기일은 수주일 이후여야 합니다.</small>
                </div>
                <div class="col-span-12">
                    <label for="amount" class="block mb-2 font-medium">수주금액</label>
                    <InputNumber
                        inputId="amount"
                        v-model="draft.amount"
                        mode="currency"
                        currency="KRW"
                        locale="ko-KR"
                        :min="0"
                        required
                        :pt="{ pcInputText: { root: { 'aria-required': 'true', 'aria-describedby': 'amount-error' } } }"
                        fluid
                        :invalid="submitted && draftErrors.amount"
                    />
                    <small v-if="submitted && draftErrors.amount" id="amount-error" class="text-red-700 dark:text-red-400" role="alert">0원보다 큰 수주금액을 입력하세요.</small>
                </div>
            </div>
            <template #footer>
                <Button label="취소" icon="pi pi-times" text severity="secondary" @click="orderDialog = false" />
                <Button label="등록" icon="pi pi-check" :loading="saving" @click="saveOrder" />
            </template>
        </Dialog>

        <ConfirmDialog />
    </div>
</template>
