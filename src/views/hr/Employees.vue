<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useHrStore } from '@/stores/hr';
import { useAuthStore } from '@/stores/auth';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { useHrReferenceStore } from '@/stores/hrReference';
import { createHrRepository } from '@/repositories/hr/hrRepository';
import ReferenceCatalog from './ReferenceCatalog.vue';
import EmployeeAccount from './EmployeeAccount.vue';
import EmployeeEmployment from './EmployeeEmployment.vue';
import EmployeeSecondaryAssignments from './EmployeeSecondaryAssignments.vue';
const references = useHrReferenceStore();
const repository = createHrRepository();
const kinds = { department: '부서', grade: '직급', position: '직책' };
const referenceName = (kind, code) => {
    const item = references.catalog.value.find((x) => x.kind === kind && x.code === code);
    return item ? `${item.name} (${code})` : code || '—';
};
const options = (kind) => references.catalog.value.filter((x) => x.kind === kind && x.isActive);
const inactive = (kind) => draft.value[kind] && !options(kind).some((x) => x.code === draft.value[kind]);
const correctionTime = (value) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const corrections = ref([]);
const correctionsLoading = ref(false);
const correctionsError = ref('');
let historyVersion = 0;
async function loadCorrections() {
    const version = ++historyVersion;
    corrections.value = [];
    correctionsError.value = '';
    correctionsLoading.value = false;
    if (!selectedId.value || !company.value || !auth.user.value?.id) return;
    correctionsLoading.value = true;
    try {
        const rows = await repository.loadCorrections(company.value, selectedId.value);
        if (version === historyVersion) corrections.value = rows;
    } catch {
        if (version === historyVersion) correctionsError.value = '정정 이력을 불러오지 못했습니다.';
    } finally {
        if (version === historyVersion) correctionsLoading.value = false;
    }
}
const hr = useHrStore();
const auth = useAuthStore();
const runtime = useEnterpriseRuntimeStore();
const { directory, loading, saving, error } = hr;
const moduleState = computed(() => directory.value?.moduleState || 'enabled');
const company = computed(() => (runtime.context.value?.mode === 'active' ? runtime.context.value.companyId : null));
const search = ref('');
const selectedId = ref(null);
const detailVersion = ref(0);
const selected = computed(() => directory.value?.employees.find((item) => item.id === selectedId.value));
const dialog = ref(null);
const draft = ref({});
const reason = ref('');
const confirmed = ref(false);
const validation = ref('');
const cancelTarget = ref(null);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const statusLabel = (status) => ({ planned: '입사 예정', active: '재직', terminated: '퇴사' })[status] || status;
const siteName = (id) => directory.value?.sites.find((item) => item.id === id)?.name || (id ? '비활성 또는 미조회 사업장' : '미지정');
const actions = computed(() => [...(selected.value?.actions || [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));
const latest = computed(() => actions.value.filter((item) => !item.cancelled).at(-1));
const statusTone = (status) => ({ planned: 'info', active: 'success', terminated: 'secondary' })[status] || 'secondary';
const actionTypeOptions = [
    { value: 'transfer', label: '주 소속 변경' },
    { value: 'terminate', label: '퇴사' }
];
const accountOptions = computed(() => [{ value: '', label: '연결하지 않음' }, ...(directory.value?.accounts || []).map((account) => ({ value: account.id, label: account.name }))]);
const siteOptions = computed(() => [{ value: '', label: '미지정' }, ...(directory.value?.sites || []).map((site) => ({ value: site.id, label: site.name }))]);
const referenceOptions = (kind) => {
    const list = [{ value: '', label: '미지정' }];
    if (inactive(kind)) list.push({ value: draft.value[kind], label: referenceName(kind, draft.value[kind]) + ' · 사용 중지 또는 미조회', disabled: true });
    return [...list, ...options(kind).map((item) => ({ value: item.code, label: item.name + ' (' + item.code + ')' }))];
};
function resetSearch() {
    search.value = '';
    load(1);
}
function close() {
    dialog.value = null;
    draft.value = {};
    reason.value = '';
    confirmed.value = false;
    validation.value = '';
    cancelTarget.value = null;
}
function correct() {
    close();
    draft.value = { name: selected.value.name };
    dialog.value = 'correct';
}
function load(page = 1) {
    if (company.value) return hr.load(company.value, search.value.trim(), page);
}
watch(
    () => [auth.user.value?.id, company.value],
    ([identity, id]) => {
        hr.reset();
        references.reset();
        close();
        selectedId.value = null;
        detailVersion.value += 1;
        search.value = '';
        if (identity && id) {
            hr.load(id, '', 1);
            references.load(id);
        }
    },
    { immediate: true, flush: 'sync' }
);
watch(
    () => [selectedId.value, company.value, auth.user.value?.id],
    () => {
        close();
        loadCorrections();
    },
    { flush: 'sync' }
);
onBeforeUnmount(() => {
    ++historyVersion;
    references.reset();
    hr.reset();
    close();
});
function register() {
    close();
    draft.value = { employeeNo: '', name: '', profileId: '', hireDate: today(), siteId: '', department: '', grade: '', position: '' };
    dialog.value = 'register';
}
function action() {
    close();
    draft.value = { type: 'transfer', effectiveDate: today(), siteId: selected.value.siteId || '', department: selected.value.department || '', grade: selected.value.grade || '', position: selected.value.position || '' };
    dialog.value = 'action';
}
function cancel(item) {
    close();
    cancelTarget.value = item;
    dialog.value = 'cancel';
}
async function save() {
    validation.value = '';
    if (saving.value || !company.value) return;
    if (!reason.value.trim()) {
        validation.value = '변경 사유를 입력해 주세요.';
        return;
    }
    if ((dialog.value === 'cancel' || draft.value.type === 'terminate') && !confirmed.value) {
        validation.value = '접근 권한에 미치는 영향을 확인해 주세요.';
        return;
    }
    if ((dialog.value === 'register' || (dialog.value === 'action' && draft.value.type === 'transfer')) && (references.loading.value || references.error.value || Object.keys(kinds).some(inactive))) {
        validation.value = '사용 중인 기준정보를 선택해 주세요.';
        return;
    }
    const employeeId = selectedId.value;
    const identity = auth.user.value?.id;
    const companyId = company.value;
    let success = false;
    if (dialog.value === 'register' && directory.value?.permissions.create) {
        success = await hr.createEmployee({ ...draft.value, profileId: draft.value.profileId.trim() || null, siteId: draft.value.siteId || null }, reason.value.trim());
    } else if (selected.value && (dialog.value === 'cancel' ? directory.value?.permissions.cancel : directory.value?.permissions.update)) {
        const employee = selected.value;
        success =
            dialog.value === 'correct'
                ? await hr.correctEmployee(employee.id, employee.revision, { name: draft.value.name.trim() }, reason.value.trim())
                : dialog.value === 'cancel'
                  ? await hr.cancelAction(employee.id, cancelTarget.value.id, employee.revision, reason.value.trim())
                  : await hr.recordAction(employee.id, employee.revision, { ...draft.value, siteId: draft.value.siteId || null, reason: reason.value.trim() });
    }
    if (success && identity === auth.user.value?.id && companyId === company.value) {
        if (employeeId === selectedId.value) {
            close();
            void loadCorrections();
        }
        if (identity === auth.user.value?.id && companyId === company.value) await runtime.refresh(identity, companyId);
    }
}
async function accountChanged() {
    const identity = auth.user.value?.id;
    const companyId = company.value;
    await load(directory.value?.page || 1);
    if (identity && identity === auth.user.value?.id && companyId === company.value) await runtime.refresh(identity, companyId);
}
async function employmentChanged() {
    detailVersion.value += 1;
    await accountChanged();
}
</script>
<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 id="hr-title" class="text-2xl font-semibold text-surface-900 dark:text-surface-0">직원 명부</h1>
                <div class="mt-1 text-muted-color">현재 회사의 직원과 날짜별 주 소속 발령을 관리합니다.</div>
            </div>
            <Button v-if="directory?.permissions.create" data-testid="register" label="직원 등록" icon="pi pi-user-plus" :disabled="loading || saving" @click="register" />
        </div>

        <Message v-if="moduleState === 'draining' || moduleState === 'read_only'" data-testid="module-state-banner" severity="warn" :closable="false" class="mb-6" role="status">
            {{
                moduleState === 'draining'
                    ? '진행 건 정리 중입니다. 신규 등록과 변경은 중단되며, 권한이 있으면 예정 발령을 취소할 수 있습니다. 기존 예정 발령은 적용됩니다.'
                    : '읽기 전용 상태입니다. 인사 정보를 조회할 수 있지만 등록·변경·취소는 할 수 없습니다.'
            }}
        </Message>
        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>

        <div class="card">
            <p class="mb-4 text-muted-color">로그인 계정 연결만으로 회사 접근 권한이 생기지 않습니다. 게시된 회사 멤버십이 별도로 필요하며, 직접 지정한 레벨과 개별 예외는 유지됩니다.</p>

            <form id="employee-search-form" class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between" @submit.prevent="load(1)">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label for="employee-search" class="sr-only">직원 검색</label>
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText id="employee-search" v-model="search" type="search" maxlength="100" placeholder="사번 또는 이름" class="w-full sm:w-80" />
                    </IconField>
                    <Button type="submit" label="검색" icon="pi pi-filter" severity="secondary" outlined :disabled="loading || !company" />
                </div>
                <div v-if="directory" class="text-sm text-muted-color" aria-live="polite">
                    총 <strong class="text-color">{{ directory.total }}</strong
                    >명
                </div>
            </form>

            <p v-if="!company" role="status" class="text-muted-color">상단에서 접근 가능한 회사를 선택해 주세요.</p>
            <template v-else>
                <DataTable
                    :value="directory?.employees || []"
                    dataKey="id"
                    :loading="loading"
                    size="small"
                    stripedRows
                    scrollable
                    responsiveLayout="scroll"
                    tableStyle="min-width: 52rem"
                    :tableProps="{ 'aria-label': '직원 명부' }"
                >
                    <template #empty>
                        <div class="list-empty">
                            <p class="list-empty-message">조건에 맞는 직원이 없습니다.</p>
                            <Button v-if="search.trim()" label="검색 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetSearch" />
                        </div>
                    </template>
                    <Column header="사번 / 이름" style="min-width: 12rem">
                        <template #body="slotProps">
                            <span class="block text-sm text-muted-color">{{ slotProps.data.employeeNo }}</span>
                            <span class="font-medium">{{ slotProps.data.name }}</span>
                        </template>
                    </Column>
                    <Column header="상태">
                        <template #body="slotProps">
                            <Tag :value="statusLabel(slotProps.data.status)" :severity="statusTone(slotProps.data.status)" />
                        </template>
                    </Column>
                    <Column header="사업장 / 부서" style="min-width: 14rem">
                        <template #body="slotProps">
                            <span class="block">{{ siteName(slotProps.data.siteId) }}</span>
                            <span class="text-sm text-muted-color">{{ referenceName('department', slotProps.data.department) }}</span>
                        </template>
                    </Column>
                    <Column header="직급 / 직책" style="min-width: 14rem">
                        <template #body="slotProps">{{ referenceName('grade', slotProps.data.grade) }} / {{ referenceName('position', slotProps.data.position) }}</template>
                    </Column>
                    <Column header="상세" frozen alignFrozen="right" style="width: 8rem">
                        <template #body="slotProps">
                            <Button data-testid="employee-detail" label="상세 보기" size="small" severity="secondary" outlined :aria-label="slotProps.data.name + ' 상세 보기'" @click="selectedId = slotProps.data.id" />
                        </template>
                    </Column>
                </DataTable>

                <nav v-if="directory" class="flex flex-wrap items-center justify-end gap-3 mt-5" aria-label="직원 목록 페이지">
                    <span class="text-sm text-muted-color">총 {{ directory.total }}명 · {{ directory.page }}페이지</span>
                    <Button label="이전" icon="pi pi-angle-left" severity="secondary" outlined size="small" :disabled="directory.page <= 1" @click="load(directory.page - 1)" />
                    <Button label="다음" icon="pi pi-angle-right" iconPos="right" severity="secondary" outlined size="small" :disabled="directory.page * directory.pageSize >= directory.total" @click="load(directory.page + 1)" />
                </nav>
            </template>
        </div>

        <div v-if="selected" class="card" aria-label="선택한 직원 상세">
            <div class="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">{{ selected.name }} · {{ selected.employeeNo }}</h2>
                    <div class="mt-1 text-muted-color">입사일 {{ selected.hireDate }} · 로그인 계정 {{ selected.profileId ? '연결됨' : '연결 없음' }}</div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <Button v-if="directory.permissions.update" data-testid="correct-employee" label="기본정보 정정" icon="pi pi-pencil" severity="secondary" outlined :disabled="saving" @click="correct" />
                    <Button v-if="directory.permissions.update && selected.status !== 'terminated'" data-testid="action" label="인사 발령 기록" icon="pi pi-send" :disabled="saving || latest?.type === 'terminate'" @click="action" />
                </div>
            </div>

            <EmployeeEmployment :key="company + ':' + selected.id" :company-id="company" :employee-id="selected.id" @changed="employmentChanged" />
            <EmployeeSecondaryAssignments :key="company + ':' + selected.id + ':' + detailVersion" :company-id="company" :employee-id="selected.id" @changed="employmentChanged" />
            <EmployeeAccount :key="company + ':' + selected.id + ':' + detailVersion" :company-id="company" :employee-id="selected.id" @changed="accountChanged" />

            <h3 class="mt-6 mb-3 text-lg font-semibold">기본정보 정정 이력</h3>
            <p v-if="correctionsLoading" role="status" class="text-muted-color">정정 이력을 불러오는 중입니다.</p>
            <p v-else-if="correctionsError" role="alert" class="text-red-700 dark:text-red-400">{{ correctionsError }}</p>
            <p v-else-if="!corrections.length" class="text-muted-color">기본정보 정정 이력이 없습니다.</p>
            <ol v-else class="p-0 m-0 list-none">
                <li v-for="item in corrections" :key="item.id" class="py-4 border-b border-surface-200 dark:border-surface-700 last:border-0">
                    <strong>{{ correctionTime(item.createdAt) }}</strong>
                    <p class="mt-2 mb-0">이름 {{ item.before.name }} → {{ item.after.name }}</p>
                    <p class="mt-1 mb-0">입사일 {{ item.before.hireDate }} → {{ item.after.hireDate }}</p>
                    <p class="mt-1 mb-0 text-muted-color break-words">{{ item.reason }}</p>
                </li>
            </ol>

            <h3 class="mt-6 mb-3 text-lg font-semibold">발령 이력</h3>
            <p v-if="!actions.length" class="text-muted-color">등록 이후 발령 이력이 없습니다.</p>
            <ol v-else class="p-0 m-0 list-none">
                <li v-for="item in actions" :key="item.id" class="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-surface-200 dark:border-surface-700 last:border-0">
                    <div class="min-w-0">
                        <strong>{{ item.effectiveDate }} · {{ item.type === 'terminate' ? '퇴사' : '주 소속 변경' }}</strong>
                        <span v-if="item.cancelled" class="text-muted-color"> · 취소됨</span>
                        <span v-else class="text-muted-color"> · {{ item.effectiveDate > today() ? '예정' : '적용됨' }}</span>
                        <p v-if="item.type === 'transfer'" class="mt-1 mb-0">{{ siteName(item.siteId) }} / {{ referenceName('department', item.department) }} / {{ referenceName('grade', item.grade) }} / {{ referenceName('position', item.position) }}</p>
                        <p class="mt-1 mb-0 text-muted-color break-words">{{ item.reason }}</p>
                    </div>
                    <Button
                        v-if="directory.permissions.cancel && !item.cancelled && latest?.id === item.id && item.effectiveDate > today()"
                        label="발령 취소"
                        icon="pi pi-undo"
                        severity="secondary"
                        outlined
                        size="small"
                        :disabled="saving"
                        @click="cancel(item)"
                    />
                </li>
            </ol>
        </div>

        <ReferenceCatalog v-if="company" :key="(auth.user.value?.id || '') + ':' + company" />

        <Dialog
            :visible="Boolean(dialog)"
            modal
            :header="dialog === 'correct' ? '기본정보 정정' : dialog === 'register' ? '직원 등록' : dialog === 'cancel' ? '예정 발령 취소' : '인사 발령 기록'"
            :style="{ width: '40rem', maxWidth: '95vw' }"
            :closable="!saving"
            @update:visible="
                (value) => {
                    if (!value) close();
                }
            "
        >
            <form data-testid="save-action" class="flex flex-col gap-5" novalidate :aria-busy="saving" @submit.prevent="save">
                <template v-if="dialog === 'correct'">
                    <p class="m-0 text-muted-color">정정 전 이름: {{ selected?.name }}</p>
                    <div class="flex flex-col gap-2">
                        <label for="correction-name" class="font-medium">정정 후 이름</label>
                        <InputText id="correction-name" v-model="draft.name" required maxlength="100" fluid />
                    </div>
                    <p class="m-0 text-muted-color">입사일은 고용 이력에서 관리되며 기본정보 정정으로 변경할 수 없습니다.</p>
                </template>

                <template v-if="dialog === 'register'">
                    <div class="flex flex-col gap-2">
                        <label for="employee-no" class="font-medium">사번 (등록 후 변경 불가)</label>
                        <InputText id="employee-no" v-model="draft.employeeNo" required maxlength="100" fluid />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="employee-name" class="font-medium">이름</label>
                        <InputText id="employee-name" v-model="draft.name" required maxlength="100" fluid />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="hire-date" class="font-medium">입사일</label>
                        <InputText id="hire-date" v-model="draft.hireDate" type="date" required fluid />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label id="profile-id-label" for="profile-id" class="font-medium">로그인 계정 연결 (선택)</label>
                        <Select
                            inputId="profile-id"
                            v-model="draft.profileId"
                            :options="accountOptions"
                            optionLabel="label"
                            optionValue="value"
                            ariaLabelledby="profile-id-label"
                            aria-describedby="profile-help"
                            fluid
                        />
                        <small id="profile-help" class="text-muted-color">전사 권한관리에서 회사에 연결한 계정을 선택합니다. 등록 후 직원 상세에서 연결을 변경할 수 있습니다. 입사 예정 계정은 입사일부터 접근할 수 있습니다.</small>
                    </div>
                </template>

                <template v-if="dialog === 'action'">
                    <div class="flex flex-col gap-2">
                        <label id="action-type-label" for="action-type" class="font-medium">발령 종류</label>
                        <Select inputId="action-type" v-model="draft.type" :options="actionTypeOptions" optionLabel="label" optionValue="value" ariaLabelledby="action-type-label" fluid />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label for="action-date" class="font-medium">발효일</label>
                        <InputText id="action-date" v-model="draft.effectiveDate" type="date" :min="today()" required fluid />
                    </div>
                    <p class="m-0 text-muted-color">발효일부터 적용합니다. 퇴사일은 재직하지 않는 첫날입니다. 과거 발령은 기록할 수 없으며 같은 날짜는 취소 후에도 다시 사용할 수 없습니다.</p>
                </template>

                <template v-if="dialog === 'register' || (dialog === 'action' && draft.type === 'transfer')">
                    <div class="flex flex-col gap-2">
                        <label id="employee-site-label" for="employee-site" class="font-medium">주 사업장</label>
                        <Select inputId="employee-site" v-model="draft.siteId" :options="siteOptions" optionLabel="label" optionValue="value" ariaLabelledby="employee-site-label" fluid />
                    </div>
                    <div v-for="(label, kind) in kinds" :key="kind" class="flex flex-col gap-2">
                        <label :id="'employee-' + kind + '-label'" :for="'employee-' + kind" class="font-medium">{{ label }}</label>
                        <Select
                            :inputId="'employee-' + kind"
                            v-model="draft[kind]"
                            :options="referenceOptions(kind)"
                            optionLabel="label"
                            optionValue="value"
                            :optionDisabled="(option) => option.disabled"
                            :ariaLabelledby="'employee-' + kind + '-label'"
                            :disabled="references.loading.value"
                            fluid
                        />
                    </div>
                </template>

                <p v-if="dialog === 'action'" class="m-0 text-muted-color">승인 절차 없이 직접 기록됩니다. 주 소속만 관리하며, 직급·직책 변경은 연결 계정의 유효 레벨과 메뉴에 영향을 줍니다. 직접 지정한 레벨과 개별 예외는 유지됩니다.</p>
                <p v-if="dialog === 'cancel'" class="m-0 text-muted-color">{{ cancelTarget?.effectiveDate }} 예정 발령을 취소합니다. 이전 재직 상태와 주 소속이 계속 적용되며 예정된 접근 권한 변경도 취소됩니다.</p>

                <div class="flex flex-col gap-2">
                    <label for="action-reason" class="font-medium">변경 사유 (필수)</label>
                    <Textarea id="action-reason" v-model="reason" required rows="3" maxlength="2000" fluid />
                </div>

                <div v-if="dialog === 'cancel' || draft.type === 'terminate'" class="flex items-start gap-3">
                    <Checkbox inputId="impact-confirm" v-model="confirmed" binary />
                    <label for="impact-confirm" class="leading-relaxed">{{ dialog === 'cancel' ? '예정된 권한 변경도 취소됨을 확인했습니다.' : '퇴사일부터 연결 계정의 이 회사 접근이 차단됨을 확인했습니다.' }}</label>
                </div>

                <Message v-if="validation || error" severity="error" :closable="false" role="alert">{{ validation || error }}</Message>

                <div class="flex justify-end gap-2 pt-1">
                    <Button type="button" label="닫기" severity="secondary" text :disabled="saving" @click="close" />
                    <Button type="submit" :label="saving ? '저장 중…' : '기록 저장'" icon="pi pi-check" :disabled="saving" />
                </div>
            </form>
        </Dialog>
    </div>
</template>
