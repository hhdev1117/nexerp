<script setup>
import { formatWon, statusSeverity } from '@/data/erp';
import { useErpStore } from '@/stores/erp';
import { FilterMatchMode } from '@primevue/core/api';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const { recentOrders } = useErpStore();
const filters = ref({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS }
});

function openOrders() {
    router.push('/sales/orders');
}
</script>

<template>
    <div class="card">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
                <h2 class="font-semibold text-xl">최근 수주</h2>
                <div class="mt-1 text-sm text-muted-color">최신 고객 주문과 처리 상태입니다.</div>
            </div>
            <IconField>
                <InputIcon>
                    <i class="pi pi-search" aria-hidden="true" />
                </InputIcon>
                <InputText v-model="filters.global.value" placeholder="수주 검색" class="w-full sm:w-48" aria-label="최근 수주 검색" />
            </IconField>
        </div>

        <DataTable
            v-model:filters="filters"
            :value="recentOrders"
            :rows="5"
            :paginator="true"
            paginatorTemplate="PrevPageLink PageLinks NextPageLink"
            :globalFilterFields="['number', 'customer', 'owner', 'status']"
            responsiveLayout="scroll"
            :tableProps="{ 'aria-label': '최근 수주 목록' }"
        >
            <Column field="number" header="수주번호" :sortable="true" style="min-width: 10rem">
                <template #body="slotProps">
                    <span class="font-medium text-primary">{{ slotProps.data.number }}</span>
                </template>
            </Column>
            <Column field="customer" header="거래처" :sortable="true" style="min-width: 8rem"></Column>
            <Column field="amount" header="수주금액" :sortable="true" style="min-width: 8rem">
                <template #body="slotProps">{{ formatWon(slotProps.data.amount) }}</template>
            </Column>
            <Column field="dueDate" header="납기일" :sortable="true" style="min-width: 7.5rem"></Column>
            <Column field="status" header="상태" :sortable="true" style="min-width: 7rem">
                <template #body="slotProps">
                    <Tag :value="slotProps.data.status" :severity="statusSeverity(slotProps.data.status)" />
                </template>
            </Column>
            <Column header="보기" style="width: 4rem">
                <template #body>
                    <Button icon="pi pi-search" text rounded aria-label="수주 관리로 이동" title="수주 관리로 이동" @click="openOrders" />
                </template>
            </Column>
        </DataTable>
    </div>
</template>
