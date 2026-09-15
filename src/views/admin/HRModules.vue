<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { createEnterpriseRuntimeRepository } from '@/repositories/access/enterpriseRuntimeRepository';
import { createHrModuleRepository } from '@/repositories/hr/hrModuleRepository';
const auth = useAuthStore();
const runtime = useEnterpriseRuntimeStore();
const catalog = createEnterpriseRuntimeRepository();
const repository = createHrModuleRepository();
const companies = ref([]),
    companyId = ref(''),
    settings = ref(null);
const loading = ref(false),
    saving = ref(false),
    error = ref(''),
    notice = ref('');
const state = ref('enabled'),
    menuVisible = ref(true),
    reason = ref(''),
    review = ref(null);
const labels = { enabled: '사용 중', draining: '진행 건 정리', read_only: '읽기 전용', disabled: '사용 중지' };
const descriptions = {
    enabled: '허용된 권한에 따라 인사 조회와 변경을 할 수 있습니다.',
    draining: '신규 등록과 변경을 중단합니다. 예정 발령은 적용되거나 권한자가 취소할 수 있습니다.',
    read_only: '조회만 허용합니다. 예정 발령을 모두 처리한 뒤 전환할 수 있습니다.',
    disabled: '인사 메뉴와 직접 주소, 인사 조회·변경을 차단합니다.'
};
const core = computed(() => settings.value?.modules.find((m) => m.key === 'hr.core'));
const planned = computed(() => settings.value?.modules.filter((m) => !m.available) || []);
const authorized = computed(() => auth.profile.value?.is_active === true && auth.role.value === 'admin');
const blocked = computed(() => core.value?.pendingActions > 0 && ['read_only', 'disabled'].includes(state.value));
const companyOptions = computed(() => [{ value: '', label: '회사를 선택해 주세요', disabled: true }, ...companies.value.map((company) => ({ value: company.id, label: company.name }))]);
const stateOptions = computed(() => Object.entries(labels).map(([value, label]) => ({ value, label })));
let sequence = 0,
    catalogSequence = 0;
const resetDraft = () => {
    review.value = null;
    reason.value = '';
    notice.value = '';
};
async function load() {
    const request = ++sequence;
    if (!companyId.value || !auth.user.value?.id || !authorized.value) return;
    const id = companyId.value;
    loading.value = true;
    error.value = '';
    review.value = null;
    try {
        const result = await repository.loadSettings(id);
        if (request !== sequence) return;
        settings.value = result;
        state.value = core.value.state;
        menuVisible.value = core.value.menuVisible;
    } catch {
        if (request === sequence) error.value = '설정을 불러오지 못했습니다. 작성한 사유는 보존됩니다. 다시 불러와 주세요.';
    } finally {
        if (request === sequence) loading.value = false;
    }
}
async function loadCatalog() {
    const request = ++catalogSequence;
    if (!auth.user.value?.id || !authorized.value) return;
    loading.value = true;
    error.value = '';
    try {
        const rows = await catalog.listAdminCompanies();
        if (request !== catalogSequence) return;
        companies.value = rows;
        companyId.value = rows.some((r) => r.id === runtime.context.value?.companyId) ? runtime.context.value.companyId : rows[0]?.id || '';
    } catch {
        if (request === catalogSequence) error.value = '회사 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
    } finally {
        if (request === catalogSequence && !companyId.value) loading.value = false;
    }
}
watch(
    () => [auth.user.value?.id, authorized.value],
    () => {
        ++sequence;
        ++catalogSequence;
        companies.value = [];
        companyId.value = '';
        settings.value = null;
        loading.value = false;
        saving.value = false;
        error.value = '';
        resetDraft();
        loadCatalog();
    },
    { immediate: true, flush: 'sync' }
);
watch(
    companyId,
    () => {
        ++sequence;
        settings.value = null;
        saving.value = false;
        resetDraft();
        load();
    },
    { flush: 'sync' }
);
watch(
    [state, menuVisible, reason],
    () => {
        review.value = null;
    },
    { flush: 'sync' }
);
function prepare() {
    if (!authorized.value) return;
    error.value = '';
    if (!reason.value.trim() || reason.value.trim().length > 2000) {
        error.value = '변경 사유를 1~2000자로 입력해 주세요.';
        return;
    }
    if (!core.value || blocked.value || loading.value || saving.value) return;
    review.value = {
        companyId: companyId.value,
        companyName: companies.value.find((c) => c.id === companyId.value)?.name,
        revision: core.value.revision,
        before: core.value.state,
        beforeVisible: core.value.menuVisible,
        state: state.value,
        menuVisible: menuVisible.value,
        reason: reason.value.trim()
    };
}
async function save() {
    if (!authorized.value || !review.value || saving.value || loading.value) return;
    const change = { ...review.value },
        identity = auth.user.value?.id,
        request = ++sequence;

    saving.value = true;
    error.value = '';
    try {
        const result = await repository.saveSettings(change.companyId, 'hr.core', change.revision, change.state, change.menuVisible, change.reason);
        if (request !== sequence || auth.user.value?.id !== identity) return;
        settings.value = result;
        state.value = core.value.state;
        menuVisible.value = core.value.menuVisible;
        resetDraft();
        notice.value = '모듈 설정을 저장했습니다.';
        if (runtime.loading?.value || !runtime.context.value) {
            notice.value = '설정은 저장되었습니다. 회사 전환이 끝난 뒤 권한 새로고침을 해 주세요.';
            return;
        }
        await runtime.refresh(identity, runtime.context.value.companyId || null);
        if (request === sequence && runtime.error?.value) notice.value = '설정은 저장되었지만 메뉴 권한을 새로 불러오지 못했습니다. 권한 새로고침을 다시 시도해 주세요.';
    } catch (e) {
        if (request === sequence) {
            review.value = null;
            error.value =
                {
                    revision_conflict: '다른 관리자가 설정을 변경했습니다. 최신 설정을 다시 불러와 검토해 주세요.',
                    module_pending_actions: '예정 발령을 모두 처리하거나 취소한 뒤 전환해 주세요.',
                    access_denied: '관리자 권한과 2단계 인증을 확인해 주세요.'
                }[e.code] || '저장하지 못했습니다. 작성한 내용을 확인한 후 다시 시도해 주세요.';
        }
    } finally {
        if (request === sequence) saving.value = false;
    }
}
onBeforeUnmount(() => {
    ++sequence;
    ++catalogSequence;
});
</script>
<template>
    <div>
        <div class="mb-6">
            <p class="m-0 text-sm text-muted-color">인사 운영 설정</p>
            <h1 class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-0">인사 모듈 관리</h1>
            <div class="mt-1 text-muted-color">회사별 인사 업무의 운영 상태와 메뉴 표시를 관리합니다.</div>
        </div>

        <div class="card">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="flex flex-col flex-1 gap-2">
                    <label id="module-company-label" for="module-company" class="text-sm font-medium">관리할 회사</label>
                    <Select inputId="module-company" v-model="companyId" :options="companyOptions" optionLabel="label" optionValue="value" ariaLabelledby="module-company-label" :disabled="saving" fluid />
                </div>
                <Button data-testid="reload" label="다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined :disabled="loading || saving" @click="companies.length ? load() : loadCatalog()" />
            </div>
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
        <Message v-if="notice" severity="success" :closable="false" class="mb-6" role="status">{{ notice }}</Message>
        <p v-if="loading" role="status" class="mb-6 text-muted-color">설정을 불러오는 중입니다.</p>

        <section v-if="core" class="card">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p class="m-0 text-sm text-muted-color">사용 가능한 모듈</p>
                    <h2 class="mt-1 text-xl font-semibold text-surface-900 dark:text-surface-0">{{ core.label }}</h2>
                </div>
                <Tag :value="labels[core.state]" :severity="core.state === 'enabled' ? 'success' : core.state === 'disabled' ? 'secondary' : 'warn'" />
            </div>
            <p class="mt-2 text-muted-color">직원·소속·인사 발령을 관리하는 기본 모듈입니다.</p>

            <div class="flex flex-wrap gap-6 py-4">
                <span class="text-muted-color"
                    >설정 버전 <strong class="text-color">{{ core.revision }}</strong></span
                >
                <span class="text-muted-color"
                    >예정 발령 <strong class="text-color">{{ core.pendingActions }}건</strong></span
                >
                <span class="text-muted-color"
                    >연결 모듈 <strong class="text-color">{{ core.dependents.length }}개</strong></span
                >
            </div>
            <p class="p-4 rounded-border bg-surface-50 dark:bg-surface-800 text-muted-color">사용을 중지해도 인사 기록은 보존되며, 재직 정보에 따른 다른 ERP 업무의 회사 접근 권한은 유지됩니다.</p>

            <fieldset :disabled="loading || saving" class="p-0 mt-6 mb-0 border-0">
                <legend class="mb-4 font-semibold">운영 설정</legend>
                <div class="flex flex-col gap-2 mb-2 sm:max-w-md">
                    <label id="module-state-label" for="module-state" class="text-sm font-medium">변경할 상태</label>
                    <Select inputId="module-state" v-model="state" :options="stateOptions" optionLabel="label" optionValue="value" ariaLabelledby="module-state-label" fluid />
                </div>
                <p class="mb-4 text-muted-color">{{ descriptions[state] }}</p>
                <div class="flex items-center gap-3 mb-2">
                    <Checkbox inputId="module-menu-visible" v-model="menuVisible" binary />
                    <label for="module-menu-visible">인사 메뉴 표시</label>
                </div>
                <p class="mb-4 text-sm text-muted-color">메뉴를 숨겨도 권한이 있는 사용자는 직접 주소로 접근할 수 있습니다. 사용 중지 상태에서는 모두 차단됩니다.</p>
                <Message v-if="blocked" severity="error" :closable="false" class="mb-4">예정 발령 {{ core.pendingActions }}건을 먼저 처리하거나 취소해 주세요. 진행 건 정리 상태에서 정리할 수 있습니다.</Message>
                <div class="flex flex-col gap-2 mb-4">
                    <label for="module-reason" class="text-sm font-medium">변경 사유</label>
                    <Textarea id="module-reason" v-model="reason" maxlength="2000" rows="3" placeholder="운영 상태를 변경하는 사유를 입력해 주세요" fluid />
                </div>
                <Button data-testid="review" label="변경 내용 검토" icon="pi pi-eye" :disabled="blocked" @click="prepare" />
            </fieldset>

            <section v-if="review" data-testid="change-review" class="p-5 mt-6 rounded-border bg-surface-50 dark:bg-surface-800">
                <h3 class="mb-3 text-base font-semibold">변경 내용 확인</h3>
                <p class="m-0">{{ review.companyName }} · 인사 기본 · 버전 {{ review.revision }}</p>
                <p class="mt-1 mb-0">운영 상태: {{ labels[review.before] }} → {{ labels[review.state] }}</p>
                <p class="mt-1 mb-0">메뉴 표시: {{ review.beforeVisible ? '표시' : '숨김' }} → {{ review.menuVisible ? '표시' : '숨김' }}</p>
                <p class="mt-1 mb-0 text-muted-color">{{ descriptions[review.state] }}</p>
                <p class="mt-1 mb-4 break-words">사유: {{ review.reason }}</p>
                <Button data-testid="confirm-save" label="확인하고 저장" icon="pi pi-check" :disabled="saving" @click="save" />
            </section>
        </section>

        <section v-if="settings" data-testid="planned-modules" class="card">
            <p class="m-0 text-sm text-muted-color">준비 중인 모듈</p>
            <h2 class="mt-1 text-xl font-semibold text-surface-900 dark:text-surface-0">
                준비 중인 모듈 <small class="text-muted-color">{{ planned.length }}</small>
            </h2>
            <p class="mt-1 mb-4 text-muted-color">아래 모듈은 아직 제공되지 않으며 활성화할 수 없습니다.</p>
            <ul class="grid grid-cols-1 gap-3 p-0 m-0 list-none md:grid-cols-3">
                <li v-for="module in planned" :key="module.key" class="flex items-center justify-between gap-2 p-4 border rounded-border border-surface-200 dark:border-surface-700">
                    <span>{{ module.label }}</span>
                    <Tag value="준비 중" severity="secondary" />
                </li>
            </ul>
        </section>
    </div>
</template>
