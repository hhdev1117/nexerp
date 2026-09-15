<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { createHrEmploymentRepository } from '@/repositories/hr/hrEmploymentRepository';

const props = defineProps({ companyId: { type: String, required: true }, employeeId: { type: String, required: true } });
const emit = defineEmits(['changed']);
const auth = useAuthStore();
const repository = createHrEmploymentRepository();
const history = ref(null);
const preparation = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const formOpen = ref(false);
const review = ref(null);
const cancelTarget = ref(null);
const cancelReason = ref('');
const cancelConfirmed = ref(false);
const draft = ref({});
let sequence = 0;

const labels = { planned: '재직 예정', active: '재직', terminated: '퇴사', cancelled: '취소됨' };
const employments = computed(() => history.value?.employments || []);
const latest = computed(() => employments.value.filter((row) => !row.cancelled).at(-1));
const referenceRows = (kind) => preparation.value?.references.filter((row) => row.kind === kind) || [];
const referenceName = (kind, code) => referenceRows(kind).find((row) => row.code === code)?.name || code || '미지정';
const siteName = (id) => preparation.value?.sites.find((row) => row.id === id)?.name || (id ? '비활성 사업장' : '미지정');
const referenceOptions = (kind) => [{ value: '', label: '선택' }, ...referenceRows(kind).map((row) => ({ value: row.code, label: row.name + ' (' + row.code + ')' }))];
const siteOptions = computed(() => [{ value: '', label: '미지정' }, ...(preparation.value?.sites || []).map((row) => ({ value: row.id, label: row.name }))]);
const candidateOptions = computed(() => [{ value: '', label: '선택' }, ...(preparation.value?.accountCandidates || []).map((row) => ({ value: row.id, label: row.name }))]);
const accountModeOptions = [
    { value: 'keep', label: '기존 연결 유지' },
    { value: 'unlink', label: '연결 해제' },
    { value: 'replace', label: '다른 계정 연결' }
];
const accountName = computed(() =>
    draft.value.accountMode === 'replace'
        ? preparation.value?.accountCandidates.find((row) => row.id === draft.value.profileId)?.name || '선택 필요'
        : draft.value.accountMode === 'unlink'
          ? '연결 해제'
          : preparation.value?.currentAccount?.name || '연결 없음'
);
const selectedCandidate = computed(() => preparation.value?.accountCandidates.find((row) => row.id === draft.value.profileId));
const accessPreview = computed(() => {
    const candidate = selectedCandidate.value;
    if (draft.value.accountMode !== 'replace') {
        if (draft.value.accountMode === 'unlink') return { level: null, source: 'unlinked' };
        const current = preparation.value?.accountCandidates.find((row) => row.id === preparation.value?.currentAccount?.id);
        if (!current) return { level: null, source: preparation.value?.currentAccount ? 'not_member' : 'unlinked' };
        if (current.preview.source === 'direct') return current.preview;
    } else if (!candidate) return { level: null, source: 'unlinked' };
    else if (candidate.preview.source === 'direct') return candidate.preview;
    const position = preparation.value?.mappings.find((row) => row.kind === 'position' && row.code === draft.value.position);
    if (position) return { level: position.level, source: 'position' };
    const grade = preparation.value?.mappings.find((row) => row.kind === 'grade' && row.code === draft.value.grade);
    return grade ? { level: grade.level, source: 'grade' } : { level: null, source: 'unmapped' };
});
const levelText = (row) => {
    if (row?.level) return `레벨 ${row.level} · ${{ direct: '계정 직접 지정', position: '직책 매핑', grade: '직급 매핑' }[row.source]}`;
    return { unlinked: '연결 계정 없음', unmapped: '매핑된 등급 없음', not_member: '회사 정책 적용 대상 아님', unpublished: '발행 정책 없음' }[row?.source] || '확인 필요';
};
function clearEditor() {
    formOpen.value = false;
    review.value = null;
    cancelTarget.value = null;
    cancelReason.value = '';
    cancelConfirmed.value = false;
    draft.value = {};
}
async function load() {
    const request = ++sequence;
    history.value = null;
    preparation.value = null;
    loading.value = false;
    error.value = '';
    notice.value = '';
    clearEditor();
    if (!props.companyId || !props.employeeId || !auth.user.value?.id) return;
    loading.value = true;
    try {
        const [historyResult, preparationResult] = await Promise.all([repository.loadHistory(props.companyId, props.employeeId), repository.prepareRehire(props.companyId, props.employeeId)]);
        if (request !== sequence) return;
        history.value = historyResult;
        preparation.value = preparationResult;
    } catch {
        if (request === sequence) error.value = '고용 이력을 불러오지 못했습니다. 권한을 확인하고 다시 시도해 주세요.';
    } finally {
        if (request === sequence) loading.value = false;
    }
}
function openRehire() {
    error.value = '';
    notice.value = '';
    review.value = null;
    const base = latest.value;
    draft.value = {
        hireDate: preparation.value?.earliestHireDate || '',
        siteId: base?.siteId || '',
        department: base?.department || '',
        grade: base?.grade || '',
        position: base?.position || '',
        accountMode: 'keep',
        profileId: '',
        reason: ''
    };
    formOpen.value = true;
}
function validate() {
    if (!draft.value.hireDate || draft.value.hireDate < preparation.value.earliestHireDate) return `재입사일은 ${preparation.value.earliestHireDate} 이후여야 합니다.`;
    if (!referenceRows('department').some((row) => row.code === draft.value.department)) return '사용 중인 부서를 선택해 주세요.';
    if (!referenceRows('grade').some((row) => row.code === draft.value.grade)) return '사용 중인 직급을 선택해 주세요.';
    if (!referenceRows('position').some((row) => row.code === draft.value.position)) return '사용 중인 직책을 선택해 주세요.';
    if (draft.value.accountMode === 'replace' && !selectedCandidate.value) return '연결할 로그인 계정을 선택해 주세요.';
    if (!draft.value.reason?.trim() || draft.value.reason.trim().length > 2000) return '변경 사유를 1~2000자로 입력해 주세요.';
    return '';
}
function prepareReview() {
    error.value = validate();
    if (error.value) return;
    review.value = {
        revision: preparation.value.employeeRevision,
        beforeEndDate: latest.value?.endDate,
        hireDate: draft.value.hireDate,
        siteId: draft.value.siteId || null,
        department: draft.value.department,
        grade: draft.value.grade,
        position: draft.value.position,
        accountMode: draft.value.accountMode,
        profileId: draft.value.accountMode === 'replace' ? draft.value.profileId : null,
        accountName: accountName.value,
        preview: accessPreview.value,
        reason: draft.value.reason.trim()
    };
}
async function saveRehire() {
    if (!review.value || saving.value) return;
    const change = { ...review.value };
    const request = ++sequence;
    const identity = auth.user.value?.id;
    saving.value = true;
    error.value = '';
    try {
        const result = await repository.createReemployment(
            props.companyId,
            props.employeeId,
            change.revision,
            { hireDate: change.hireDate, siteId: change.siteId, department: change.department, grade: change.grade, position: change.position, accountMode: change.accountMode, profileId: change.profileId },
            change.reason
        );
        if (request !== sequence || identity !== auth.user.value?.id) return;
        history.value = result;
        if (preparation.value) preparation.value = { ...preparation.value, employeeRevision: result.employeeRevision, eligible: false, permissions: { create: false } };
        clearEditor();
        notice.value = '재입사 회차를 등록했습니다. 입사일부터 재직 권한이 적용됩니다.';
        emit('changed');
    } catch (cause) {
        if (request === sequence) {
            review.value = null;
            error.value = cause?.message || '재입사를 등록하지 못했습니다.';
        }
    } finally {
        if (request === sequence) saving.value = false;
    }
}
function openCancel(row) {
    cancelTarget.value = row;
    cancelReason.value = '';
    cancelConfirmed.value = false;
    error.value = '';
    notice.value = '';
}
async function cancelEmployment() {
    if (!cancelTarget.value || saving.value) return;
    if (!cancelReason.value.trim() || !cancelConfirmed.value) {
        error.value = '취소 사유를 입력하고 계정·권한 영향을 확인해 주세요.';
        return;
    }
    const request = ++sequence;
    const identity = auth.user.value?.id;
    const target = cancelTarget.value;
    saving.value = true;
    error.value = '';
    try {
        const result = await repository.cancelPlanned(props.companyId, props.employeeId, target.id, history.value.employeeRevision, cancelReason.value.trim());
        if (request !== sequence || identity !== auth.user.value?.id) return;
        history.value = result;
        cancelTarget.value = null;
        cancelReason.value = '';
        cancelConfirmed.value = false;
        notice.value = '재입사 예정 회차를 취소했습니다.';
        emit('changed');
    } catch (cause) {
        if (request === sequence) error.value = cause?.message || '재입사 예정 회차를 취소하지 못했습니다.';
    } finally {
        if (request === sequence) saving.value = false;
    }
}
watch(() => [props.companyId, props.employeeId, auth.user.value?.id], load, { immediate: true, flush: 'sync' });
watch(draft, () => (review.value = null), { deep: true });
onBeforeUnmount(() => ++sequence);
</script>
<template>
    <section class="mt-8" aria-labelledby="employment-title">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 id="employment-title" class="text-lg font-semibold text-surface-900 dark:text-surface-0">고용 이력</h3>
            <Button v-if="preparation?.eligible && preparation.permissions.create" data-testid="rehire-open" label="재입사 등록" icon="pi pi-user-plus" size="small" :disabled="loading || saving" @click="openRehire" />
        </div>

        <p v-if="loading" role="status" class="text-muted-color">고용 이력을 불러오는 중입니다.</p>
        <Message v-if="error" severity="error" :closable="false" class="mb-4" role="alert">{{ error }}</Message>
        <Message v-if="notice" severity="success" :closable="false" class="mb-4" role="status">{{ notice }}</Message>
        <p v-if="history && !history.permissions.create && !history.permissions.cancel" data-testid="employment-readonly" class="mb-4 text-muted-color">고용 이력은 조회만 할 수 있습니다.</p>

        <ol v-if="history" class="grid gap-3 p-0 m-0 list-none">
            <li v-for="row in employments" :key="row.id" :data-testid="'employment-cycle-' + row.sequenceNo" class="p-4 border rounded-border border-surface-200 dark:border-surface-700">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <strong>{{ row.sequenceNo }}회차 · {{ labels[row.status] }}</strong>
                    <Button
                        v-if="row.status === 'planned' && history.permissions.cancel"
                        data-testid="employment-cancel-open"
                        label="예정 회차 취소"
                        icon="pi pi-undo"
                        size="small"
                        severity="secondary"
                        outlined
                        :disabled="saving"
                        @click="openCancel(row)"
                    />
                </div>
                <p class="mt-2 mb-0">
                    {{ row.hireDate }} 입사<span v-if="row.endDate"> · {{ row.endDate }} 퇴사</span>
                </p>
                <p class="mt-1 mb-0 text-muted-color">{{ siteName(row.siteId) }} / {{ referenceName('department', row.department) }} / {{ referenceName('grade', row.grade) }} / {{ referenceName('position', row.position) }}</p>
                <p v-if="row.cancelled" class="mt-1 mb-0">취소됨 · {{ row.cancellationReason }}</p>
                <ul v-if="row.actions.length" class="mt-3 mb-0 pl-5 text-muted-color">
                    <li v-for="action in row.actions" :key="action.id">{{ action.effectiveDate }} · {{ action.type === 'terminate' ? '퇴사' : '소속 변경' }}<span v-if="action.cancelled"> · 취소됨</span></li>
                </ul>
            </li>
        </ol>

        <form v-if="formOpen" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800" novalidate @submit.prevent="prepareReview">
            <h4 class="mb-2 text-base font-semibold">재입사 정보</h4>
            <p class="mb-4 text-muted-color">이전 퇴사일 {{ latest?.endDate }} · 가장 빠른 재입사일 {{ preparation.earliestHireDate }}</p>
            <div class="grid grid-cols-12 gap-4">
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label for="rehire-date" class="font-medium">재입사일</label>
                    <InputText id="rehire-date" v-model="draft.hireDate" type="date" :min="preparation.earliestHireDate" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="rehire-site-label" for="rehire-site" class="font-medium">주 사업장</label>
                    <Select inputId="rehire-site" v-model="draft.siteId" :options="siteOptions" optionLabel="label" optionValue="value" ariaLabelledby="rehire-site-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="rehire-department-label" for="rehire-department" class="font-medium">부서</label>
                    <Select inputId="rehire-department" v-model="draft.department" :options="referenceOptions('department')" optionLabel="label" optionValue="value" ariaLabelledby="rehire-department-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="rehire-grade-label" for="rehire-grade" class="font-medium">직급</label>
                    <Select inputId="rehire-grade" v-model="draft.grade" :options="referenceOptions('grade')" optionLabel="label" optionValue="value" ariaLabelledby="rehire-grade-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="rehire-position-label" for="rehire-position" class="font-medium">직책</label>
                    <Select inputId="rehire-position" v-model="draft.position" :options="referenceOptions('position')" optionLabel="label" optionValue="value" ariaLabelledby="rehire-position-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6">
                    <label id="rehire-account-mode-label" for="rehire-account-mode" class="font-medium">로그인 계정 처리</label>
                    <Select inputId="rehire-account-mode" v-model="draft.accountMode" :options="accountModeOptions" optionLabel="label" optionValue="value" ariaLabelledby="rehire-account-mode-label" fluid />
                </div>
                <div v-if="draft.accountMode === 'replace'" class="flex flex-col col-span-12 gap-2">
                    <label id="rehire-profile-label" for="rehire-profile" class="font-medium">연결할 계정</label>
                    <Select inputId="rehire-profile" v-model="draft.profileId" :options="candidateOptions" optionLabel="label" optionValue="value" ariaLabelledby="rehire-profile-label" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2">
                    <label for="rehire-reason" class="font-medium">변경 사유</label>
                    <Textarea id="rehire-reason" v-model="draft.reason" rows="3" maxlength="2000" fluid />
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-4">
                <Button type="button" label="닫기" severity="secondary" text :disabled="saving" @click="clearEditor" />
                <Button data-testid="rehire-review" type="button" label="변경 내용 검토" icon="pi pi-eye" :disabled="saving" @click="prepareReview" />
            </div>
        </form>

        <section v-if="review" data-testid="rehire-review-panel" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800">
            <h4 class="mb-3 text-base font-semibold">재입사 등록 확인</h4>
            <p class="m-0">{{ review.beforeEndDate }} 퇴사 → {{ review.hireDate }} 재입사</p>
            <p class="mt-1 mb-0">{{ siteName(review.siteId) }} / {{ referenceName('department', review.department) }} / {{ referenceName('grade', review.grade) }} / {{ referenceName('position', review.position) }}</p>
            <p class="mt-1 mb-0">로그인 계정: {{ review.accountName }} · {{ levelText(review.preview) }}</p>
            <p class="mt-1 mb-4 text-muted-color break-words">사유: {{ review.reason }}</p>
            <Button data-testid="rehire-save" label="확인하고 등록" icon="pi pi-check" :disabled="saving" @click="saveRehire" />
        </section>

        <section v-if="cancelTarget" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800">
            <h4 class="mb-3 text-base font-semibold">재입사 예정 취소</h4>
            <p class="mt-0 mb-4">{{ cancelTarget.sequenceNo }}회차 · {{ cancelTarget.hireDate }} 입사 예정</p>
            <div class="flex flex-col gap-2 mb-4">
                <label for="employment-cancel-reason" class="font-medium">취소 사유</label>
                <Textarea id="employment-cancel-reason" v-model="cancelReason" rows="2" maxlength="2000" fluid />
            </div>
            <div class="flex items-start gap-3 mb-4">
                <Checkbox inputId="employment-cancel-confirm" v-model="cancelConfirmed" binary />
                <label for="employment-cancel-confirm" class="leading-relaxed">계정 연결과 예정 권한에 미치는 영향을 확인했습니다.</label>
            </div>
            <Button data-testid="employment-cancel-save" label="확인하고 취소" icon="pi pi-check" severity="danger" :disabled="saving" @click="cancelEmployment" />
        </section>
    </section>
</template>
