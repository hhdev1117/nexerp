<script setup>
import { formatWon, statusSeverity } from '@/data/erp';
import { useErpStore } from '@/stores/erp';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref } from 'vue';

const confirm = useConfirm();
const toast = useToast();
const { approvals, pendingApprovalCount, isPendingApproval, updateApprovalStatus } = useErpStore();
const keyword = ref('');
const approvalTableRegion = ref();
const viewMode = ref('전체');
const viewOptions = ['전체', '처리 대기', '처리 완료'];

const filteredApprovals = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');

    return approvals.value.filter((approval) => {
        const pending = isPending(approval);
        const matchesMode = viewMode.value === '전체' || (viewMode.value === '처리 대기' ? pending : !pending);
        const matchesKeyword = !query || [approval.id, approval.type, approval.title, approval.requester].some((value) => value.toLocaleLowerCase('ko-KR').includes(query));
        return matchesMode && matchesKeyword;
    });
});

function isPending(approval) {
    return isPendingApproval(approval);
}

function severity(status) {
    return status === '반려' ? 'danger' : statusSeverity(status);
}

async function focusApprovalWorkflow() {
    await nextTick();
    const nextApproveButton = approvalTableRegion.value?.querySelector('[data-approval-action="approve"]');
    (nextApproveButton || approvalTableRegion.value)?.focus();
}

async function approve(approval) {
    updateApprovalStatus(approval.id, '승인 완료');
    toast.add({ severity: 'success', summary: '승인 완료', detail: `${approval.id} 요청을 승인했습니다.`, life: 3000 });
    await focusApprovalWorkflow();
}

function reject(approval) {
    confirm.require({
        group: 'approval',
        message: `${approval.id} 요청을 반려하시겠습니까?`,
        header: '결재 반려',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: '반려', severity: 'danger' },
        accept: async () => {
            updateApprovalStatus(approval.id, '반려');
            toast.add({ severity: 'warn', summary: '반려 완료', detail: `${approval.id} 요청을 반려했습니다.`, life: 3000 });
            await focusApprovalWorkflow();
        }
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

        <div ref="approvalTableRegion" class="card" role="region" aria-label="결재 요청 목록" tabindex="-1">
            <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <SelectButton v-model="viewMode" :options="viewOptions" :allowEmpty="false" />
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="keyword" placeholder="문서번호, 제목, 요청자 검색" aria-label="결재 검색" class="w-full sm:w-80" />
                </IconField>
            </div>

            <DataTable :value="filteredApprovals" dataKey="id" responsiveLayout="scroll" tableStyle="min-width: 72rem" :tableProps="{ 'aria-label': '결재 요청 목록' }" paginator :rows="5" scrollable>
                <template #empty>조건에 맞는 결재 요청이 없습니다.</template>
                <Column field="id" header="문서번호" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium text-primary">{{ slotProps.data.id }}</span></template
                    >
                </Column>
                <Column field="type" header="업무 유형" sortable />
                <Column field="title" header="제목" sortable style="min-width: 18rem" />
                <Column field="requester" header="요청자" sortable />
                <Column field="requestedAt" header="요청일시" sortable />
                <Column field="amount" header="금액" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium">{{ formatWon(slotProps.data.amount) }}</span></template
                    >
                </Column>
                <Column field="status" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="slotProps.data.status" :severity="severity(slotProps.data.status)" /></template>
                </Column>
                <Column header="결재 처리" frozen alignFrozen="right" style="min-width: 13rem">
                    <template #body="slotProps">
                        <div v-if="isPending(slotProps.data)" class="flex gap-2">
                            <Button label="승인" icon="pi pi-check" size="small" class="whitespace-nowrap" :aria-label="`${slotProps.data.id} 승인`" data-approval-action="approve" @click="approve(slotProps.data)" />
                            <Button label="반려" icon="pi pi-times" size="small" severity="danger" outlined class="whitespace-nowrap" :aria-label="`${slotProps.data.id} 반려`" @click="reject(slotProps.data)" />
                        </div>
                        <span v-else class="text-sm text-muted-color">처리 완료</span>
                    </template>
                </Column>
            </DataTable>
        </div>

        <ConfirmDialog group="approval" />
    </div>
</template>
