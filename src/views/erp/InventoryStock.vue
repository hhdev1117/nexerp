<script setup>
import { inventoryRows } from '@/data/erp';
import { STOCK_STATUS, statusLabel, statusOptions, statusSeverity } from '@/data/status';
import { computed, ref } from 'vue';

const keyword = ref('');
const selectedStatus = ref(null);
const stockStatusOptions = statusOptions('stock');

const filteredRows = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return inventoryRows.filter((item) => {
        const matchesStatus = !selectedStatus.value || item.status === selectedStatus.value;
        const matchesKeyword = !query || [item.code, item.name, item.warehouse, statusLabel(item.status)].some((value) => value.toLocaleLowerCase('ko-KR').includes(query));
        return matchesStatus && matchesKeyword;
    });
});

const totalStock = computed(() => inventoryRows.reduce((sum, item) => sum + item.stock, 0));
const riskCount = computed(() => inventoryRows.filter((item) => item.status !== STOCK_STATUS.NORMAL).length);
const warehouseCount = computed(() => new Set(inventoryRows.map((item) => item.warehouse)).size);

function stockRatio(item) {
    return Math.min(100, Math.round((item.stock / item.safety) * 100));
}
</script>

<template>
    <div>
        <div class="mb-6">
            <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">재고 현황</h1>
            <div class="mt-1 text-muted-color">창고별 가용 재고와 안전재고 위험 품목을 확인합니다.</div>
        </div>

        <div class="grid grid-cols-12 gap-6 mb-6">
            <div class="col-span-12 md:col-span-4">
                <div class="card mb-0">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="mb-2 text-sm font-medium text-muted-color">총 재고 수량</div>
                            <div class="text-2xl font-semibold">{{ totalStock.toLocaleString('ko-KR') }} EA</div>
                        </div>
                        <div class="flex items-center justify-center w-10 h-10 bg-blue-100 dark:bg-blue-400/10 rounded-border">
                            <i class="text-xl text-blue-500 pi pi-box" aria-hidden="true" />
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-span-12 md:col-span-4">
                <div class="card mb-0">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="mb-2 text-sm font-medium text-muted-color">위험 품목</div>
                            <div class="text-2xl font-semibold">{{ riskCount }} 품목</div>
                        </div>
                        <div class="flex items-center justify-center w-10 h-10 bg-orange-100 dark:bg-orange-400/10 rounded-border">
                            <i class="text-xl text-orange-500 pi pi-exclamation-triangle" aria-hidden="true" />
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-span-12 md:col-span-4">
                <div class="card mb-0">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="mb-2 text-sm font-medium text-muted-color">운영 창고</div>
                            <div class="text-2xl font-semibold">{{ warehouseCount }} 개소</div>
                        </div>
                        <div class="flex items-center justify-center w-10 h-10 bg-cyan-100 dark:bg-cyan-400/10 rounded-border">
                            <i class="text-xl text-cyan-500 pi pi-warehouse" aria-hidden="true" />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-col gap-3 sm:flex-row">
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="keyword" placeholder="품목코드, 품목명, 창고 검색" aria-label="재고 검색" class="w-full sm:w-80" />
                    </IconField>
                    <Select v-model="selectedStatus" :options="stockStatusOptions" optionLabel="label" optionValue="value" placeholder="전체 상태" aria-label="재고 상태 필터" showClear class="w-full sm:w-40" />
                </div>
                <div class="text-sm text-muted-color">조회 결과 {{ filteredRows.length }}건</div>
            </div>

            <DataTable :value="filteredRows" dataKey="code" responsiveLayout="scroll" tableStyle="min-width: 62rem" :tableProps="{ 'aria-label': '재고 현황 목록' }" stripedRows>
                <template #empty>조건에 맞는 재고 품목이 없습니다.</template>
                <Column field="code" header="품목코드" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium text-primary">{{ slotProps.data.code }}</span></template
                    >
                </Column>
                <Column field="name" header="품목명" sortable />
                <Column field="warehouse" header="창고" sortable />
                <Column field="stock" header="현재고" sortable>
                    <template #body="slotProps">{{ slotProps.data.stock.toLocaleString('ko-KR') }} {{ slotProps.data.unit }}</template>
                </Column>
                <Column field="safety" header="안전재고" sortable>
                    <template #body="slotProps">{{ slotProps.data.safety.toLocaleString('ko-KR') }} {{ slotProps.data.unit }}</template>
                </Column>
                <Column header="안전재고 충족률" style="min-width: 10rem">
                    <template #body="slotProps">
                        <div class="flex items-center gap-3">
                            <ProgressBar :value="stockRatio(slotProps.data)" :showValue="false" class="flex-1" style="height: 0.45rem" />
                            <span class="w-10 text-sm text-right">{{ stockRatio(slotProps.data) }}%</span>
                        </div>
                    </template>
                </Column>
                <Column field="status" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="statusLabel(slotProps.data.status)" :severity="statusSeverity(slotProps.data.status)" /></template>
                </Column>
            </DataTable>
        </div>
    </div>
</template>
