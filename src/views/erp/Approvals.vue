<script setup>
import { APPROVAL_DECISION_ROLES, formatWon } from '@/data/erp';
import { APPROVAL_STATUS, statusLabel, statusSeverity } from '@/data/status';
import { useAuthStore } from '@/stores/auth';
import { useErpStore } from '@/stores/erp';
import { numberParam, useQueryState } from '@/composables/useQueryState';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';

const DECISION_FAILURE_MESSAGE = '결재를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NO_PERMISSION_MESSAGE = '결재 승인과 반려는 결재자 또는 관리자 계정에서만 처리할 수 있습니다.';

const confirm = useConfirm();
const toast = useToast();
const authStore = useAuthStore();
const { approvals, pendingApprovalCount, isPendingApproval, updateApprovalStatus, loading, error } = useErpStore();
const { keyword, view: viewMode, page, rows, reset: resetQueryState } = useQueryState({ keyword: { fallback: '' }, view: { fallback: '전체' }, page: numberParam(1), rows: numberParam(20) });
const approvalTableRegion = ref();
const viewOptions = ['전체', '처리 대기', '처리 완료'];
const canDecide = computed(() => authStore.hasRole(APPROVAL_DECISION_ROLES));

const filteredApprovals = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return approvals.value.filter((approval) => {
        const pending = isPending(approval);
        const matchesMode = viewMode.value === '전체' || (viewMode.value === '처리 대기' ? pending : !pending);
        const matchesKeyword = !query || [approval.id, approval.type, approval.title, approval.requester, statusLabel(approval.status)].some((value) => String(value).toLocaleLowerCase('ko-KR').includes(query));
        return matchesMode && matchesKeyword;
    });
});

function isPending(approval) {
    return isPendingApproval(approval);
}

function resetFilters() {
    resetQueryState();
}

const first = computed(() => (page.value - 1) * rows.value);

function changePage(event) {
    page.value = Math.floor(event.first / event.rows) + 1;
    rows.value = event.rows;
}

watch([keyword, viewMode], () => {
    page.value = 1;
});

async function focusApprovalWorkflow() {
    await nextTick();
    const nextApproveButton = approvalTableRegion.value?.querySelector('[data-approval-action="approve"]');
    (nextApproveButton || approvalTableRegion.value)?.focus();
}

function notifyNoPermission() {
    toast.add({ severity: 'warn', summary: '결재 권한 없음', detail: NO_PERMISSION_MESSAGE, life: 3200 });
}

async function decide(approval, status, success) {
    if (!canDecide.value) {
        notifyNoPermission();
        return;
    }

    try {
        await updateApprovalStatus(approval.id, status);
        toast.add(success);
    } catch (cause) {
        toast.add({ severity: 'error', summary: '결재 처리 실패', detail: cause?.code === 'invalid_status_transition' ? cause.message : DECISION_FAILURE_MESSAGE, life: 3200 });
    }

    await focusApprovalWorkflow();
}

function approve(approval) {
    return decide(approval, APPROVAL_STATUS.APPROVED, { severity: 'success', summary: '승인 완료', detail: `${approval.id} 요청을 승인했습니다.`, life: 3000 });
}

function reject(approval) {
    if (!canDecide.value) {
        notifyNoPermission();
        return;
    }

    confirm.require({
        group: 'approval',
        message: `${approval.id} 요청을 반려하시겠습니까?`,
        header: '결재 반려',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: '반려', severity: 'danger' },
        accept: () => decide(approval, APPROVAL_STATUS.REJECTED, { severity: 'warn', summary: '반려 완료', detail: `${approval.id} 요청을 반려했습니다.`, life: 3000 })
    });
}
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-end md:justify-between">
            <div>
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">결재함</h1>
                <div class="mt-1 text-muted-color">업무 요청을 검토하고 승인 또는 반려합니다.</div>
            </div>
            <Tag :value="`처리 대기 ${pendingApprovalCount}건`" severity="warn" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6">{{ error }}</Message>
        <Message v-if="!canDecide" severity="info" :closable="false" class="mb-6">{{ NO_PERMISSION_MESSAGE }} 현재 계정은 결재 요청을 조회만 할 수 있습니다.</Message>

        <div ref="approvalTableRegion" class="card" role="region" aria-label="결재 요청 목록" tabindex="-1">
            <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <SelectButton v-model="viewMode" :options="viewOptions" :allowEmpty="false" />
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="keyword" placeholder="문서번호, 제목, 요청자 검색" aria-label="결재 검색" class="w-full sm:w-80" />
                </IconField>
            </div>

            <DataTable
                :value="filteredApprovals"
                dataKey="id"
                :loading="loading"
                responsiveLayout="scroll"
                tableClass="min-w-0 lg:min-w-[72rem]"
                :tableProps="{ 'aria-label': '결재 요청 목록' }"
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
                        <p class="list-empty-message">조건에 맞는 결재 요청이 없습니다.</p>
                        <Button v-if="keyword.trim() || viewMode !== '전체'" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilters" />
                    </div>
                </template>
                <Column field="id" header="문서번호" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium">{{ slotProps.data.id }}</span> <span class="block text-sm lg:hidden text-muted-color">{{ slotProps.data.title }} · {{ slotProps.data.requester }}</span></template
                    >
                </Column>
                <Column field="type" header="업무 유형" sortable headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="title" header="제목" sortable style="min-width: 18rem" headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="requester" header="요청자" sortable headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="requestedAt" header="요청일시" sortable headerClass="hidden lg:table-cell" bodyClass="hidden lg:table-cell" />
                <Column field="amount" header="금액" sortable headerClass="num-col" bodyClass="num-col">
                    <template #body="slotProps"
                        ><span class="font-medium">{{ formatWon(slotProps.data.amount) }}</span></template
                    >
                </Column>
                <Column field="status" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="statusLabel(slotProps.data.status)" :severity="statusSeverity(slotProps.data.status)" /></template>
                </Column>
                <Column header="결재 처리" frozen alignFrozen="right" style="min-width: 13rem">
                    <template #body="slotProps">
                        <div v-if="isPending(slotProps.data) && canDecide" class="flex gap-2">
                            <Button label="승인" icon="pi pi-check" size="small" class="whitespace-nowrap" :aria-label="`${slotProps.data.id} 승인`" data-approval-action="approve" @click="approve(slotProps.data)" />
                            <Button label="반려" icon="pi pi-times" size="small" severity="danger" outlined class="whitespace-nowrap" :aria-label="`${slotProps.data.id} 반려`" @click="reject(slotProps.data)" />
                        </div>
                        <span v-else-if="isPending(slotProps.data)" class="text-sm text-muted-color">결재자 처리 대기</span>
                        <span v-else class="text-sm text-muted-color">처리 완료</span>
                    </template>
                </Column>
            </DataTable>
        </div>

        <ConfirmDialog group="approval" />
    </div>
</template>
