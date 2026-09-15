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
watch(
    () => [props.companyId, props.employeeId, auth.user.value?.id],
    load,
    { immediate: true, flush: 'sync' }
);
watch(draft, () => (review.value = null), { deep: true });
onBeforeUnmount(() => ++sequence);
</script>

<template>
    <section class="employment" aria-labelledby="employment-title">
        <div class="employment-heading">
            <h3 id="employment-title" class="font-semibold">고용 이력</h3>
            <Button
                v-if="preparation?.eligible && preparation.permissions.create"
                data-testid="rehire-open"
                label="재입사 등록"
                :disabled="loading || saving"
                @click="openRehire"
            />
        </div>
        <p v-if="loading" role="status">고용 이력을 불러오는 중입니다.</p>
        <p v-if="error" role="alert" class="employment-error">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="history && !history.permissions.create && !history.permissions.cancel" data-testid="employment-readonly" class="employment-note">고용 이력은 조회만 할 수 있습니다.</p>
        <ol v-if="history" class="cycle-list">
            <li v-for="row in employments" :key="row.id" :data-testid="`employment-cycle-${row.sequenceNo}`" class="cycle-card">
                <div class="cycle-title">
                    <strong>{{ row.sequenceNo }}회차 · {{ labels[row.status] }}</strong>
                    <Button
                        v-if="row.status === 'planned' && history.permissions.cancel"
                        data-testid="employment-cancel-open"
                        label="예정 회차 취소"
                        severity="secondary"
                        :disabled="saving"
                        @click="openCancel(row)"
                    />
                </div>
                <p>{{ row.hireDate }} 입사<span v-if="row.endDate"> · {{ row.endDate }} 퇴사</span></p>
                <p>{{ siteName(row.siteId) }} / {{ referenceName('department', row.department) }} / {{ referenceName('grade', row.grade) }} / {{ referenceName('position', row.position) }}</p>
                <p v-if="row.cancelled">취소됨 · {{ row.cancellationReason }}</p>
                <ul v-if="row.actions.length" class="action-list">
                    <li v-for="action in row.actions" :key="action.id">{{ action.effectiveDate }} · {{ action.type === 'terminate' ? '퇴사' : '소속 변경' }}<span v-if="action.cancelled"> · 취소됨</span></li>
                </ul>
            </li>
        </ol>

        <form v-if="formOpen" class="rehire-form" @submit.prevent="prepareReview">
            <h4 class="font-semibold">재입사 정보</h4>
            <p class="employment-note">이전 퇴사일 {{ latest?.endDate }} · 가장 빠른 재입사일 {{ preparation.earliestHireDate }}</p>
            <div class="rehire-grid">
                <label>재입사일<input id="rehire-date" v-model="draft.hireDate" type="date" :min="preparation.earliestHireDate" /></label>
                <label>주 사업장<select id="rehire-site" v-model="draft.siteId"><option value="">미지정</option><option v-for="row in preparation.sites" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
                <label>부서<select id="rehire-department" v-model="draft.department"><option value="">선택</option><option v-for="row in referenceRows('department')" :key="row.id" :value="row.code">{{ row.name }} ({{ row.code }})</option></select></label>
                <label>직급<select id="rehire-grade" v-model="draft.grade"><option value="">선택</option><option v-for="row in referenceRows('grade')" :key="row.id" :value="row.code">{{ row.name }} ({{ row.code }})</option></select></label>
                <label>직책<select id="rehire-position" v-model="draft.position"><option value="">선택</option><option v-for="row in referenceRows('position')" :key="row.id" :value="row.code">{{ row.name }} ({{ row.code }})</option></select></label>
                <label>로그인 계정 처리<select id="rehire-account-mode" v-model="draft.accountMode"><option value="keep">기존 연결 유지</option><option value="unlink">연결 해제</option><option value="replace">다른 계정 연결</option></select></label>
                <label v-if="draft.accountMode === 'replace'" class="wide">연결할 계정<select id="rehire-profile" v-model="draft.profileId"><option value="">선택</option><option v-for="row in preparation.accountCandidates" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
                <label class="wide">변경 사유<textarea id="rehire-reason" v-model="draft.reason" rows="3" maxlength="2000" /></label>
            </div>
            <div class="employment-actions"><Button data-testid="rehire-review" label="변경 내용 검토" type="button" :disabled="saving" @click="prepareReview" /><Button label="닫기" type="button" severity="secondary" :disabled="saving" @click="clearEditor" /></div>
        </form>

        <section v-if="review" data-testid="rehire-review-panel" class="review-panel">
            <h4 class="font-semibold">재입사 등록 확인</h4>
            <p>{{ review.beforeEndDate }} 퇴사 → {{ review.hireDate }} 재입사</p>
            <p>{{ siteName(review.siteId) }} / {{ referenceName('department', review.department) }} / {{ referenceName('grade', review.grade) }} / {{ referenceName('position', review.position) }}</p>
            <p>로그인 계정: {{ review.accountName }} · {{ levelText(review.preview) }}</p>
            <p>사유: {{ review.reason }}</p>
            <Button data-testid="rehire-save" label="확인하고 등록" :disabled="saving" @click="saveRehire" />
        </section>

        <section v-if="cancelTarget" class="review-panel">
            <h4 class="font-semibold">재입사 예정 취소</h4>
            <p>{{ cancelTarget.sequenceNo }}회차 · {{ cancelTarget.hireDate }} 입사 예정</p>
            <label>취소 사유<textarea id="employment-cancel-reason" v-model="cancelReason" rows="2" maxlength="2000" /></label>
            <label class="confirm"><input id="employment-cancel-confirm" v-model="cancelConfirmed" type="checkbox" /> 계정 연결과 예정 권한에 미치는 영향을 확인했습니다.</label>
            <Button data-testid="employment-cancel-save" label="확인하고 취소" severity="danger" :disabled="saving" @click="cancelEmployment" />
        </section>
    </section>
</template>

<style scoped>
.employment { display: grid; gap: 1rem; margin: 1.5rem 0; }
.employment-heading, .cycle-title, .employment-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; }
.cycle-list { display: grid; gap: .75rem; margin: 0; padding: 0; list-style: none; }
.cycle-card { padding: 1rem; border: 1px solid var(--surface-border); border-radius: 12px; }
.cycle-card p { margin: .4rem 0; }
.action-list { margin: .75rem 0 0; padding-left: 1.25rem; color: var(--text-color-secondary); }
.rehire-form, .review-panel { display: grid; gap: 1rem; padding: 1.25rem; border-radius: 12px; background: var(--surface-100, #f1f5f9); }
.rehire-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.rehire-grid label, .review-panel label { display: grid; gap: .4rem; }
.rehire-grid .wide { grid-column: 1 / -1; }
.employment :is(select, input[type='date'], textarea) { width: 100%; min-width: 0; padding: .65rem; border: 1px solid var(--surface-border); border-radius: 8px; background: var(--surface-card); color: var(--text-color); }
.employment-note { color: var(--text-color-secondary); line-height: 1.7; }
.employment-error { color: var(--red-600, #b91c1c); line-height: 1.7; }
.confirm { display: flex !important; grid-template-columns: auto 1fr; align-items: start; }
.confirm input { width: auto; margin-top: .25rem; }
@media (max-width: 640px) {
    .rehire-grid { grid-template-columns: 1fr; }
    .rehire-grid .wide { grid-column: auto; }
    .employment :deep(button) { min-height: 44px; }
}
</style>
