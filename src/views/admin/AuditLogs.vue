<script setup>
import { AUDIT_PAGE_SIZE, auditActionLabel, auditActionOptions, auditActionSeverity, auditChanges, auditSubject, auditedTableLabel, auditedTableOptions, formatAuditTimestamp, formatAuditValue } from '@/data/audit';
import { useAdminApi } from '@/services/adminApi';
import { useAuditStore } from '@/stores/audit';
import { useAuthStore } from '@/stores/auth';
import { computed, onMounted, ref } from 'vue';

const READ_ONLY_MESSAGE = '감사 로그는 관리자 계정에서만 조회할 수 있습니다.';

const authStore = useAuthStore();
const auditStore = useAuditStore();
const adminApi = useAdminApi();
const { entries, total, page, pageCount, filter, hasFilters, loading, error, ensureLoaded, applyFilter, resetFilter, goToPage } = auditStore;

const isAdmin = computed(() => authStore.hasRole(['admin']));
const accounts = ref([]);
const accountsError = ref('');
const selectedEntry = ref(null);

const actorOptions = computed(() => accounts.value.map((account) => ({ value: account.id, label: account.displayName || account.email })));
const selectedChanges = computed(() => (selectedEntry.value ? auditChanges(selectedEntry.value) : []));
const detailTitle = computed(() => (selectedEntry.value ? `${auditedTableLabel(selectedEntry.value.tableName)} ${auditActionLabel(selectedEntry.value.action)} 상세` : '변경 상세'));

// The ledger stores account identifiers; names come from the administrator account directory.
function actorName(id) {
    if (!id) return '시스템';
    const account = accounts.value.find((candidate) => candidate.id === id);
    return account ? account.displayName || account.email : '확인할 수 없는 계정';
}

async function loadAccounts() {
    accountsError.value = '';
    try {
        accounts.value = await adminApi.listAccounts();
    } catch {
        accounts.value = [];
        accountsError.value = '작업자 목록을 불러오지 못했습니다. 작업자 이름 대신 식별자가 표시됩니다.';
    }
}

onMounted(() => {
    if (!isAdmin.value) return;
    ensureLoaded();
    loadAccounts();
});

const onPage = (event) => goToPage(event.page + 1);
const openDetail = (entry) => (selectedEntry.value = entry);
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">감사 로그</h1>
                <div class="mt-1 text-muted-color">기준정보 변경 이력을 조회합니다. 기록은 데이터베이스가 직접 남기며 어떤 계정도 수정하거나 삭제할 수 없습니다.</div>
            </div>
            <Button v-if="isAdmin" label="새로 고침" icon="pi pi-refresh" severity="secondary" outlined :loading="loading" @click="auditStore.reload()" />
        </div>

        <Message v-if="!isAdmin" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>
        <template v-else>
            <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
            <Message v-if="accountsError" severity="warn" :closable="false" class="mb-6" role="alert">{{ accountsError }}</Message>

            <div class="card">
                <div class="grid grid-cols-12 gap-4 mb-6">
                    <div class="col-span-12 sm:col-span-6 xl:col-span-3">
                        <label id="audit-table-label" for="audit-table" class="block mb-2 font-medium">대상</label>
                        <Select
                            inputId="audit-table"
                            :modelValue="filter.tableName"
                            :options="auditedTableOptions"
                            optionLabel="label"
                            optionValue="value"
                            ariaLabelledby="audit-table-label"
                            placeholder="전체 대상"
                            showClear
                            fluid
                            @update:modelValue="applyFilter({ tableName: $event ?? null })"
                        />
                    </div>
                    <div class="col-span-12 sm:col-span-6 xl:col-span-2">
                        <label id="audit-action-label" for="audit-action" class="block mb-2 font-medium">작업</label>
                        <Select
                            inputId="audit-action"
                            :modelValue="filter.action"
                            :options="auditActionOptions"
                            optionLabel="label"
                            optionValue="value"
                            ariaLabelledby="audit-action-label"
                            placeholder="전체 작업"
                            showClear
                            fluid
                            @update:modelValue="applyFilter({ action: $event ?? null })"
                        />
                    </div>
                    <div class="col-span-12 sm:col-span-6 xl:col-span-3">
                        <label id="audit-actor-label" for="audit-actor" class="block mb-2 font-medium">작업자</label>
                        <Select
                            inputId="audit-actor"
                            :modelValue="filter.actorId"
                            :options="actorOptions"
                            optionLabel="label"
                            optionValue="value"
                            ariaLabelledby="audit-actor-label"
                            placeholder="전체 작업자"
                            showClear
                            filter
                            fluid
                            @update:modelValue="applyFilter({ actorId: $event ?? null })"
                        />
                    </div>
                    <div class="col-span-12 sm:col-span-6 xl:col-span-2">
                        <label id="audit-from-label" for="audit-from" class="block mb-2 font-medium">시작일</label>
                        <DatePicker inputId="audit-from" :modelValue="filter.from" dateFormat="yy-mm-dd" showIcon iconDisplay="input" ariaLabelledby="audit-from-label" placeholder="시작일" fluid @update:modelValue="applyFilter({ from: $event ?? null })" />
                    </div>
                    <div class="col-span-12 sm:col-span-6 xl:col-span-2">
                        <label id="audit-to-label" for="audit-to" class="block mb-2 font-medium">종료일</label>
                        <DatePicker inputId="audit-to" :modelValue="filter.to" dateFormat="yy-mm-dd" showIcon iconDisplay="input" ariaLabelledby="audit-to-label" placeholder="종료일" fluid @update:modelValue="applyFilter({ to: $event ?? null })" />
                    </div>
                </div>

                <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="text-sm text-muted-color" aria-live="polite">
                        총 <strong class="text-color">{{ total }}</strong
                        >건
                    </div>
                    <Button v-if="hasFilters" data-testid="audit-reset" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilter()" />
                </div>

                <DataTable :value="entries" dataKey="id" :loading="loading" size="small" stripedRows scrollable responsiveLayout="scroll" tableStyle="min-width: 58rem" :tableProps="{ 'aria-label': '감사 로그 목록' }">
                    <template #empty>
                        <div class="list-empty">
                            <p class="list-empty-message">{{ hasFilters ? '조건에 맞는 변경 이력이 없습니다.' : '아직 기록된 변경 이력이 없습니다.' }}</p>
                            <Button v-if="hasFilters" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilter()" />
                        </div>
                    </template>
                    <Column header="변경 일시" style="min-width: 11rem">
                        <template #body="slotProps">{{ formatAuditTimestamp(slotProps.data.changedAt) }}</template>
                    </Column>
                    <Column header="대상">
                        <template #body="slotProps">{{ auditedTableLabel(slotProps.data.tableName) }}</template>
                    </Column>
                    <Column header="대상 레코드" style="min-width: 14rem">
                        <template #body="slotProps">
                            <span class="font-medium">{{ auditSubject(slotProps.data) }}</span>
                        </template>
                    </Column>
                    <Column header="작업">
                        <template #body="slotProps"><Tag :value="auditActionLabel(slotProps.data.action)" :severity="auditActionSeverity(slotProps.data.action)" /></template>
                    </Column>
                    <Column header="작업자" style="min-width: 10rem">
                        <template #body="slotProps">{{ actorName(slotProps.data.actorId) }}</template>
                    </Column>
                    <Column header="변경 항목">
                        <template #body="slotProps">{{ auditChanges(slotProps.data).length }}건</template>
                    </Column>
                    <Column header="상세" frozen alignFrozen="right" style="width: 6rem">
                        <template #body="slotProps">
                            <Button
                                data-testid="audit-detail"
                                icon="pi pi-search"
                                text
                                rounded
                                :aria-label="`${formatAuditTimestamp(slotProps.data.changedAt)} ${auditedTableLabel(slotProps.data.tableName)} 변경 상세`"
                                :title="`${auditedTableLabel(slotProps.data.tableName)} 변경 상세`"
                                @click="openDetail(slotProps.data)"
                            />
                        </template>
                    </Column>
                </DataTable>

                <Paginator v-if="pageCount > 1" :rows="AUDIT_PAGE_SIZE" :totalRecords="total" :first="(page - 1) * AUDIT_PAGE_SIZE" class="mt-4" @page="onPage" />
            </div>
        </template>

        <Dialog :visible="Boolean(selectedEntry)" modal :header="detailTitle" :style="{ width: '44rem' }" :breakpoints="{ '640px': '94vw' }" @update:visible="selectedEntry = null">
            <div v-if="selectedEntry" class="flex flex-col gap-5">
                <dl class="grid grid-cols-12 gap-3 m-0">
                    <div class="col-span-12 sm:col-span-6">
                        <dt class="text-sm text-muted-color">변경 일시</dt>
                        <dd class="m-0 font-medium">{{ formatAuditTimestamp(selectedEntry.changedAt) }}</dd>
                    </div>
                    <div class="col-span-12 sm:col-span-6">
                        <dt class="text-sm text-muted-color">작업자</dt>
                        <dd class="m-0 font-medium">{{ actorName(selectedEntry.actorId) }}</dd>
                    </div>
                    <div class="col-span-12 sm:col-span-6">
                        <dt class="text-sm text-muted-color">대상 레코드</dt>
                        <dd class="m-0 font-medium break-words">{{ auditSubject(selectedEntry) }}</dd>
                    </div>
                    <div class="col-span-12 sm:col-span-6">
                        <dt class="text-sm text-muted-color">식별자</dt>
                        <dd class="m-0 break-words">{{ selectedEntry.recordId }}</dd>
                    </div>
                </dl>

                <DataTable :value="selectedChanges" dataKey="field" size="small" stripedRows responsiveLayout="scroll" :tableProps="{ 'aria-label': '변경 항목 목록' }">
                    <template #empty>
                        <div class="list-empty"><p class="list-empty-message">표시할 변경 항목이 없습니다.</p></div>
                    </template>
                    <Column field="label" header="항목" style="min-width: 9rem" />
                    <Column header="이전">
                        <template #body="slotProps">{{ formatAuditValue(slotProps.data.before) }}</template>
                    </Column>
                    <Column header="이후">
                        <template #body="slotProps">{{ formatAuditValue(slotProps.data.after) }}</template>
                    </Column>
                </DataTable>

                <div class="flex justify-end">
                    <Button type="button" label="닫기" severity="secondary" text @click="selectedEntry = null" />
                </div>
            </div>
        </Dialog>
    </div>
</template>
