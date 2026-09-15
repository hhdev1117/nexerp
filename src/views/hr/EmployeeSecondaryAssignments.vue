<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createHrSecondaryAssignmentRepository } from '@/repositories/hr/hrSecondaryAssignmentRepository';
import { useAuthStore } from '@/stores/auth';

const props = defineProps({ companyId: { type: String, required: true }, employeeId: { type: String, required: true }, repository: { type: Object, default: null }, identity: { type: String, default: '' } });
const emit = defineEmits(['changed']);
const repository = props.repository || createHrSecondaryAssignmentRepository();
const auth = useAuthStore();
const history = ref(null),
    preparation = ref(null),
    loading = ref(false),
    error = ref(''),
    mode = ref(''),
    saving = ref(false);
const draft = ref({ employmentId: '', siteId: '', department: '', position: '', startDate: '', endDate: '', reason: '' });
const actionTarget = ref(null),
    actionReason = ref(''),
    actionEndDate = ref('');
let version = 0;
const statusLabel = (s) => ({ planned: '예정', active: '진행 중', ended: '종료', cancelled: '취소' })[s] || s;
const statusTone = (s) => ({ planned: 'info', active: 'success', ended: 'secondary', cancelled: 'secondary' })[s] || 'secondary';
const referenceOptions = (kind) => [{ value: '', label: '선택' }, ...(preparation.value?.references || []).filter((x) => x.kind === kind).map((x) => ({ value: x.code, label: x.name }))];
const siteOptions = computed(() => [{ value: '', label: '선택' }, ...(preparation.value?.sites || []).map((x) => ({ value: x.id, label: x.name }))]);
async function load() {
    const v = ++version;
    loading.value = true;
    error.value = '';
    try {
        const [h, p] = await Promise.all([repository.loadHistory(props.companyId, props.employeeId), repository.prepare(props.companyId, props.employeeId)]);
        if (v === version) {
            history.value = h;
            preparation.value = p;
        }
    } catch (e) {
        if (v === version) error.value = e.message;
    } finally {
        if (v === version) loading.value = false;
    }
}
function openCreate() {
    const cycle = preparation.value?.employmentCycles.find((x) => !x.endDate) || preparation.value?.employmentCycles.at(-1);
    draft.value = { employmentId: cycle?.id || '', siteId: '', department: '', position: '', startDate: '', endDate: '', reason: '' };
    mode.value = 'create';
}
function reviewCreate() {
    error.value = '';
    if (!draft.value.siteId || !draft.value.department || !draft.value.position || !draft.value.startDate || !draft.value.reason.trim()) {
        error.value = '필수 항목을 입력해 주세요.';
        return;
    }
    mode.value = 'review';
}
function referenceName(kind, code) {
    return preparation.value?.references.find((x) => x.kind === kind && x.code === code)?.name || code;
}
function positionLevel(code) {
    return preparation.value?.mappings.find((x) => x.kind === 'position' && x.code === code)?.level || null;
}
async function create() {
    saving.value = true;
    try {
        history.value = await repository.create(
            props.companyId,
            props.employeeId,
            history.value.employeeRevision,
            { employmentId: draft.value.employmentId, siteId: draft.value.siteId, department: draft.value.department, position: draft.value.position, startDate: draft.value.startDate, endDate: draft.value.endDate || null },
            draft.value.reason
        );
        mode.value = '';
        emit('changed');
    } catch (e) {
        error.value = e.message;
    } finally {
        saving.value = false;
    }
}
function openAction(row, type) {
    actionTarget.value = row;
    actionReason.value = '';
    actionEndDate.value = '';
    mode.value = type;
}
async function saveAction() {
    if (!actionReason.value.trim() || (mode.value === 'end' && !actionEndDate.value)) {
        error.value = '종료일과 사유를 입력해 주세요.';
        return;
    }
    saving.value = true;
    try {
        history.value =
            mode.value === 'end'
                ? await repository.end(props.companyId, props.employeeId, actionTarget.value.id, history.value.employeeRevision, actionTarget.value.revision, actionEndDate.value, actionReason.value)
                : await repository.cancel(props.companyId, props.employeeId, actionTarget.value.id, history.value.employeeRevision, actionTarget.value.revision, actionReason.value);
        mode.value = '';
        emit('changed');
    } catch (e) {
        error.value = e.message;
    } finally {
        saving.value = false;
    }
}
watch(
    () => [props.companyId, props.employeeId, props.identity || auth.user.value?.id],
    () => {
        mode.value = '';
        actionTarget.value = null;
        load();
    },
    { immediate: true }
);
onBeforeUnmount(() => version++);
</script>
<template>
    <section class="mt-8" aria-labelledby="secondary-title">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
                <h3 id="secondary-title" class="text-lg font-semibold text-surface-900 dark:text-surface-0">겸직</h3>
                <div class="mt-1 text-muted-color">개인 직급은 주 소속의 직급을 그대로 사용합니다.</div>
            </div>
            <Button v-if="history?.permissions.create" data-testid="secondary-create-open" label="겸직 등록" icon="pi pi-plus" size="small" @click="openCreate" />
        </div>

        <p v-if="loading" role="status" class="text-muted-color">겸직 이력을 불러오는 중입니다.</p>
        <Message v-if="error" severity="error" :closable="false" class="mb-4" role="alert">{{ error }}</Message>
        <p v-if="history && !history.permissions.create && !history.permissions.end && !history.permissions.cancel" data-testid="secondary-readonly" class="mb-4 text-muted-color">겸직 이력은 조회만 가능합니다.</p>

        <div class="grid gap-3">
            <div v-for="row in history?.assignments" :key="row.id" :data-testid="'secondary-assignment-' + row.status" class="flex flex-wrap items-center justify-between gap-3 p-4 border rounded-border border-surface-200 dark:border-surface-700">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <strong>{{ referenceName('department', row.department) }}</strong>
                        <Tag :value="statusLabel(row.status)" :severity="statusTone(row.status)" />
                    </div>
                    <p class="mt-1 mb-0 text-muted-color">{{ row.position }} · 개인 직급 {{ row.grade }}</p>
                    <p class="mt-1 mb-0 text-muted-color">{{ row.startDate }} ~ {{ row.endDate || '계속' }}</p>
                </div>
                <Button v-if="row.status === 'planned' && history.permissions.cancel" label="예정 취소" icon="pi pi-undo" size="small" severity="secondary" outlined :disabled="saving" @click="openAction(row, 'cancel')" />
                <Button v-if="row.status === 'active' && history.permissions.end" label="겸직 종료" icon="pi pi-sign-out" size="small" severity="secondary" outlined :disabled="saving" @click="openAction(row, 'end')" />
            </div>
        </div>

        <form v-if="mode === 'create'" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800" novalidate @submit.prevent="reviewCreate">
            <div class="grid grid-cols-12 gap-4">
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="secondary-site-label" for="secondary-site" class="font-medium">사업장</label>
                    <Select inputId="secondary-site" v-model="draft.siteId" :options="siteOptions" optionLabel="label" optionValue="value" ariaLabelledby="secondary-site-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="secondary-department-label" for="secondary-department" class="font-medium">부서</label>
                    <Select inputId="secondary-department" v-model="draft.department" :options="referenceOptions('department')" optionLabel="label" optionValue="value" ariaLabelledby="secondary-department-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="secondary-position-label" for="secondary-position" class="font-medium">직책</label>
                    <Select inputId="secondary-position" v-model="draft.position" :options="referenceOptions('position')" optionLabel="label" optionValue="value" ariaLabelledby="secondary-position-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label for="secondary-start-date" class="font-medium">시작일</label>
                    <InputText id="secondary-start-date" v-model="draft.startDate" type="date" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label for="secondary-end-date" class="font-medium">종료일 (선택)</label>
                    <InputText id="secondary-end-date" v-model="draft.endDate" type="date" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2">
                    <label for="secondary-reason" class="font-medium">등록 사유</label>
                    <Textarea id="secondary-reason" v-model="draft.reason" rows="3" maxlength="2000" fluid />
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-4">
                <Button type="button" label="닫기" severity="secondary" text @click="mode = ''" />
                <Button type="button" data-testid="secondary-review" label="검토" icon="pi pi-eye" @click="reviewCreate" />
            </div>
        </form>

        <div v-if="mode === 'review'" data-testid="secondary-review-panel" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800">
            <h4 class="mb-3 text-base font-semibold">등록 내용 확인</h4>
            <p class="m-0">개인 직급 {{ referenceName('grade', preparation.primary.grade) }} 유지 · 겸직 직책 레벨 {{ positionLevel(draft.position) || '미매핑' }} · {{ referenceName('department', draft.department) }} 및 하위 조직</p>
            <p class="mt-1 mb-4">{{ draft.startDate }} ~ {{ draft.endDate || '계속' }}</p>
            <div class="flex justify-end gap-2">
                <Button label="수정" severity="secondary" text @click="mode = 'create'" />
                <Button data-testid="secondary-create-save" :label="saving ? '저장 중' : '확정 등록'" icon="pi pi-check" :disabled="saving" @click="create" />
            </div>
        </div>

        <form v-if="mode === 'end' || mode === 'cancel'" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800" novalidate @submit.prevent="saveAction">
            <div class="grid grid-cols-12 gap-4">
                <div v-if="mode === 'end'" class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label for="secondary-action-end" class="font-medium">종료일</label>
                    <InputText id="secondary-action-end" v-model="actionEndDate" type="date" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2">
                    <label for="secondary-action-reason" class="font-medium">{{ mode === 'end' ? '종료' : '취소' }} 사유</label>
                    <Textarea id="secondary-action-reason" v-model="actionReason" rows="3" maxlength="2000" fluid />
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-4">
                <Button type="button" label="닫기" severity="secondary" text @click="mode = ''" />
                <Button type="submit" data-testid="secondary-action-save" :label="saving ? '저장 중' : '확정'" icon="pi pi-check" :disabled="saving" @click.prevent="saveAction" />
            </div>
        </form>
    </section>
</template>
