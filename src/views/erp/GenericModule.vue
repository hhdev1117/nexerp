<script setup>
import { getModuleDefinition } from '@/data/erp';
import { TASK_STATUS, statusLabel, statusOptions, statusSeverity } from '@/data/status';
import { useErpStore } from '@/stores/erp';
import { numberParam, useQueryState } from '@/composables/useQueryState';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const toast = useToast();
const { getGenericRecords, ensureGenericRecords, addGenericRecord } = useErpStore();
const { keyword, status: selectedStatus, page, rows, reset: resetQueryState } = useQueryState({ keyword: { fallback: '' }, status: { fallback: null }, page: numberParam(1), rows: numberParam(20) });
const recordDialog = ref(false);
const detailDialog = ref(false);
const selectedRow = ref(null);
const submitted = ref(false);
const saving = ref(false);
const createdRows = computed(() => getGenericRecords(route.path));
const taskStatusOptions = statusOptions('task');
const emptyRecord = () => ({ subject: '', owner: '김서준', status: TASK_STATUS.IN_PROGRESS });
const record = ref(emptyRecord());

const moduleDefinition = computed(() => {
    const fallback = getModuleDefinition(route.path);
    const moduleMeta = route.meta.module || {};

    return {
        title: route.meta.title || moduleMeta.title || fallback.title,
        description: route.meta.description || moduleMeta.description || fallback.description,
        icon: route.meta.icon || moduleMeta.icon || fallback.icon
    };
});

// Modules without a dedicated screen show only real records: sample documents would be indistinguishable from live work.
const moduleRows = computed(() => [...createdRows.value, ...(Array.isArray(route.meta.rows) ? route.meta.rows : [])]);
const modulePending = computed(() => !Array.isArray(route.meta.rows));

const statusFilterOptions = computed(() => [...new Set(moduleRows.value.map((row) => row.status || TASK_STATUS.IN_PROGRESS))].map((code) => ({ value: code, label: statusLabel(code) })));

const filteredRows = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return moduleRows.value.filter((row) => {
        const matchesStatus = !selectedStatus.value || row.status === selectedStatus.value;
        const matchesKeyword = !query || [row.id, row.subject, row.owner, statusLabel(row.status)].filter(Boolean).some((value) => String(value).toLocaleLowerCase('ko-KR').includes(query));
        return matchesStatus && matchesKeyword;
    });
});

const hasActiveFilters = computed(() => Boolean(keyword.value.trim() || selectedStatus.value));
const first = computed(() => (page.value - 1) * rows.value);

function changePage(event) {
    page.value = Math.floor(event.first / event.rows) + 1;
    rows.value = event.rows;
}

watch([keyword, selectedStatus], () => {
    page.value = 1;
});

function resetFilters() {
    resetQueryState();
}

watch(
    () => route.path,
    (path) => {
        recordDialog.value = false;
        detailDialog.value = false;
        selectedRow.value = null;
        ensureGenericRecords(path);
    },
    { immediate: true }
);

function showDetails(row) {
    selectedRow.value = row;
    detailDialog.value = true;
}

function openRecordDialog() {
    record.value = emptyRecord();
    submitted.value = false;
    recordDialog.value = true;
}

async function saveRecord() {
    submitted.value = true;
    if (!record.value.subject.trim()) {
        await nextTick();
        document.getElementById('generic-subject')?.focus();
        return;
    }

    saving.value = true;
    try {
        await addGenericRecord(route.path, {
            subject: record.value.subject.trim(),
            owner: record.value.owner.trim() || '김서준',
            status: record.value.status
        });
        recordDialog.value = false;
        toast.add({ severity: 'success', summary: '등록 완료', detail: `${moduleDefinition.value.title} 업무가 등록되었습니다.`, life: 2500 });
    } catch {
        toast.add({ severity: 'error', summary: '등록 실패', detail: '업무를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div class="flex items-start gap-3">
                <div class="flex items-center justify-center w-11 h-11 bg-primary-100 dark:bg-primary-400/10 rounded-border shrink-0">
                    <i :class="[moduleDefinition.icon, 'text-xl text-primary']" aria-hidden="true" />
                </div>
                <div>
                    <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">{{ moduleDefinition.title }}</h1>
                    <div class="mt-1 text-muted-color">{{ moduleDefinition.description }}</div>
                </div>
            </div>
            <Button label="신규 등록" icon="pi pi-plus" @click="openRecordDialog" />
        </div>

        <Message v-if="modulePending" severity="info" :closable="false" class="mb-6"> 이 모듈의 전용 화면은 준비 중입니다. 여기서 등록한 업무는 목록에 남지만, 모듈이 완성되면 전용 화면으로 이어집니다. </Message>

        <div class="card">
            <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-col gap-3 sm:flex-row">
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="keyword" placeholder="문서번호, 업무명, 담당자 검색" aria-label="업무 검색" class="w-full sm:w-80" />
                    </IconField>
                    <Select v-model="selectedStatus" :options="statusFilterOptions" optionLabel="label" optionValue="value" placeholder="전체 상태" aria-label="업무 상태 필터" showClear class="w-full sm:w-40" />
                </div>
                <div class="text-sm text-muted-color" aria-live="polite">
                    총 <strong class="text-color">{{ filteredRows.length }}</strong
                    >건
                </div>
            </div>

            <DataTable
                :value="filteredRows"
                dataKey="id"
                responsiveLayout="scroll"
                tableClass="min-w-0 lg:min-w-[52rem]"
                :tableProps="{ 'aria-label': `${moduleDefinition.title} 목록` }"
                paginator
                :rows="rows"
                :first="first"
                :rowsPerPageOptions="[20, 50, 100]"
                size="small"
                stripedRows
                scrollable
                @page="changePage"
            >
                <template #empty>
                    <div class="list-empty">
                        <p class="list-empty-message">조건에 맞는 업무 데이터가 없습니다.</p>
                        <Button v-if="hasActiveFilters" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilters" />
                        <Button v-else label="첫 업무 등록" icon="pi pi-plus" size="small" @click="openRecordDialog" />
                    </div>
                </template>
                <Column field="id" header="문서번호" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium">{{ slotProps.data.id }}</span> <span class="block text-sm lg:hidden text-muted-color">{{ slotProps.data.subject }} · {{ slotProps.data.owner }}</span></template
                    >
                </Column>
                <Column field="subject" header="업무명" sortable style="min-width: 18rem" headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="owner" header="담당자" sortable headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="updatedAt" header="최종 수정" sortable headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="status" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="statusLabel(slotProps.data.status)" :severity="statusSeverity(slotProps.data.status)" /></template>
                </Column>
                <Column header="작업" frozen alignFrozen="right" style="width: 6rem">
                    <template #body="slotProps">
                        <Button icon="pi pi-search" text rounded :aria-label="`${slotProps.data.id} 상세 보기`" :title="`${slotProps.data.id} 상세 보기`" @click="showDetails(slotProps.data)" />
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="recordDialog" modal :header="`${moduleDefinition.title} 신규 등록`" :style="{ width: '32rem' }" :breakpoints="{ '640px': 'calc(100vw - 2rem)' }">
            <form class="flex flex-col gap-5" novalidate @submit.prevent="saveRecord">
                <div class="flex flex-col gap-2">
                    <label for="generic-subject" class="font-medium">업무명</label>
                    <InputText id="generic-subject" v-model="record.subject" autofocus required aria-describedby="generic-subject-error" :invalid="submitted && !record.subject.trim()" placeholder="업무명을 입력하세요" />
                    <small v-if="submitted && !record.subject.trim()" id="generic-subject-error" class="text-red-700 dark:text-red-400" role="alert">업무명은 필수입니다.</small>
                </div>
                <div class="flex flex-col gap-2">
                    <label for="generic-owner" class="font-medium">담당자</label>
                    <InputText id="generic-owner" v-model="record.owner" placeholder="담당자를 입력하세요" />
                </div>
                <div class="flex flex-col gap-2">
                    <label id="generic-status-label" for="generic-status" class="font-medium">상태</label>
                    <Select inputId="generic-status" v-model="record.status" :options="taskStatusOptions" optionLabel="label" optionValue="value" aria-labelledby="generic-status-label" class="w-full" />
                </div>
                <div class="flex justify-end gap-2 pt-2">
                    <Button type="button" label="취소" severity="secondary" text @click="recordDialog = false" />
                    <Button type="submit" label="등록" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <Dialog v-model:visible="detailDialog" modal :header="`${moduleDefinition.title} 상세`" :style="{ width: '32rem' }" :breakpoints="{ '640px': 'calc(100vw - 2rem)' }">
            <dl v-if="selectedRow" class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-4 m-0">
                <dt class="text-muted-color">문서번호</dt>
                <dd class="m-0 font-medium text-primary break-all">{{ selectedRow.id }}</dd>
                <dt class="text-muted-color">업무명</dt>
                <dd class="m-0 font-medium">{{ selectedRow.subject }}</dd>
                <dt class="text-muted-color">담당자</dt>
                <dd class="m-0">{{ selectedRow.owner }}</dd>
                <dt class="text-muted-color">최종 수정</dt>
                <dd class="m-0">{{ selectedRow.updatedAt }}</dd>
                <dt class="text-muted-color">상태</dt>
                <dd class="m-0"><Tag :value="statusLabel(selectedRow.status)" :severity="statusSeverity(selectedRow.status)" /></dd>
            </dl>
            <template #footer>
                <Button label="닫기" severity="secondary" text @click="detailDialog = false" />
            </template>
        </Dialog>
    </div>
</template>
