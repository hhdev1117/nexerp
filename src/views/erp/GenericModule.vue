<script setup>
import { getModuleDefinition } from '@/data/erp';
import { TASK_STATUS, statusLabel, statusOptions, statusSeverity } from '@/data/status';
import { useErpStore } from '@/stores/erp';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const toast = useToast();
const { getGenericRecords, ensureGenericRecords, addGenericRecord } = useErpStore();
const keyword = ref('');
const selectedStatus = ref(null);
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

const modulePrefix = computed(() =>
    route.path
        .split('/')
        .filter(Boolean)
        .map((part) => part.slice(0, 2).toUpperCase())
        .join('-')
);

// Placeholder rows keep unimplemented modules browsable until each one gets a dedicated screen and table.
const moduleRows = computed(() => {
    const prefix = modulePrefix.value;
    const baseRows = Array.isArray(route.meta.rows)
        ? route.meta.rows
        : [
              { id: `${prefix}-260911-04`, subject: `${moduleDefinition.value.title} 정기 업무`, owner: '김서준', updatedAt: '2026-09-11 11:42', status: TASK_STATUS.IN_PROGRESS },
              { id: `${prefix}-260911-03`, subject: `${moduleDefinition.value.title} 신규 요청`, owner: '박지민', updatedAt: '2026-09-11 10:18', status: TASK_STATUS.PENDING_APPROVAL },
              { id: `${prefix}-260910-12`, subject: `${moduleDefinition.value.title} 월간 마감`, owner: '이현우', updatedAt: '2026-09-10 16:35', status: TASK_STATUS.DONE },
              { id: `${prefix}-260909-08`, subject: `${moduleDefinition.value.title} 변경 검토`, owner: '최유진', updatedAt: '2026-09-09 14:07', status: TASK_STATUS.ON_HOLD },
              { id: `${prefix}-260908-02`, subject: `${moduleDefinition.value.title} 데이터 점검`, owner: '윤하늘', updatedAt: '2026-09-08 09:24', status: TASK_STATUS.DONE }
          ];

    return [...createdRows.value, ...baseRows];
});

const statusFilterOptions = computed(() => [...new Set(moduleRows.value.map((row) => row.status || TASK_STATUS.IN_PROGRESS))].map((code) => ({ value: code, label: statusLabel(code) })));

const filteredRows = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return moduleRows.value.filter((row) => {
        const matchesStatus = !selectedStatus.value || row.status === selectedStatus.value;
        const matchesKeyword = !query || [row.id, row.subject, row.owner, statusLabel(row.status)].filter(Boolean).some((value) => String(value).toLocaleLowerCase('ko-KR').includes(query));
        return matchesStatus && matchesKeyword;
    });
});

watch(
    () => route.path,
    (path) => {
        keyword.value = '';
        selectedStatus.value = null;
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

        <div class="card">
            <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-col gap-3 sm:flex-row">
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="keyword" placeholder="문서번호, 업무명, 담당자 검색" aria-label="업무 검색" class="w-full sm:w-80" />
                    </IconField>
                    <Select v-model="selectedStatus" :options="statusFilterOptions" optionLabel="label" optionValue="value" placeholder="전체 상태" aria-label="업무 상태 필터" showClear class="w-full sm:w-40" />
                </div>
                <div class="text-sm text-muted-color">조회 결과 {{ filteredRows.length }}건</div>
            </div>

            <DataTable :value="filteredRows" dataKey="id" responsiveLayout="scroll" tableStyle="min-width: 52rem" :tableProps="{ 'aria-label': `${moduleDefinition.title} 목록` }" paginator :rows="5" stripedRows scrollable>
                <template #empty>조건에 맞는 업무 데이터가 없습니다.</template>
                <Column field="id" header="문서번호" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium text-primary">{{ slotProps.data.id }}</span></template
                    >
                </Column>
                <Column field="subject" header="업무명" sortable style="min-width: 18rem" />
                <Column field="owner" header="담당자" sortable />
                <Column field="updatedAt" header="최종 수정" sortable />
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
