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
    <main class="hr-modules">
        <header>
            <div class="eyebrow">인사 운영 설정</div>
            <h1>인사 모듈 관리</h1>
            <p>회사별 인사 업무의 운영 상태와 메뉴 표시를 관리합니다.</p>
        </header>
        <section class="module-card company-bar">
            <label for="module-company">관리할 회사</label
            ><select id="module-company" v-model="companyId" :disabled="saving">
                <option value="" disabled>회사를 선택해 주세요</option>
                <option v-for="company in companies" :key="company.id" :value="company.id">{{ company.name }}</option></select
            ><Button data-testid="reload" label="다시 불러오기" severity="secondary" :disabled="loading || saving" @click="companies.length ? load() : loadCatalog()" />
        </section>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="loading" role="status">설정을 불러오는 중입니다.</p>
        <section v-if="core" class="module-card">
            <div class="module-heading">
                <div>
                    <span class="eyebrow">사용 가능한 모듈</span>
                    <h2>{{ core.label }}</h2>
                </div>
                <span class="state-badge">{{ labels[core.state] }}</span>
            </div>
            <p>직원·소속·인사 발령을 관리하는 기본 모듈입니다.</p>
            <div class="facts">
                <span
                    >설정 버전 <strong>{{ core.revision }}</strong></span
                ><span
                    >예정 발령 <strong>{{ core.pendingActions }}건</strong></span
                ><span
                    >연결 모듈 <strong>{{ core.dependents.length }}개</strong></span
                >
            </div>
            <p class="module-note">사용을 중지해도 인사 기록은 보존되며, 재직 정보에 따른 다른 ERP 업무의 회사 접근 권한은 유지됩니다.</p>
            <fieldset :disabled="loading || saving">
                <legend>운영 설정</legend>
                <label for="module-state">변경할 상태</label
                ><select id="module-state" v-model="state">
                    <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
                </select>
                <p>{{ descriptions[state] }}</p>
                <label class="check"><input v-model="menuVisible" type="checkbox" /> 인사 메뉴 표시</label>
                <p class="hint">메뉴를 숨겨도 권한이 있는 사용자는 직접 주소로 접근할 수 있습니다. 사용 중지 상태에서는 모두 차단됩니다.</p>
                <p v-if="blocked" class="error">예정 발령 {{ core.pendingActions }}건을 먼저 처리하거나 취소해 주세요. 진행 건 정리 상태에서 정리할 수 있습니다.</p>
                <label for="module-reason">변경 사유</label><textarea id="module-reason" v-model="reason" maxlength="2000" rows="3" placeholder="운영 상태를 변경하는 사유를 입력해 주세요" /><Button
                    data-testid="review"
                    label="변경 내용 검토"
                    :disabled="blocked"
                    @click="prepare"
                />
            </fieldset>
            <section v-if="review" data-testid="change-review" class="change-review">
                <h3>변경 내용 확인</h3>
                <p>{{ review.companyName }} · 인사 기본 · 버전 {{ review.revision }}</p>
                <p>운영 상태: {{ labels[review.before] }} → {{ labels[review.state] }}</p>
                <p>메뉴 표시: {{ review.beforeVisible ? '표시' : '숨김' }} → {{ review.menuVisible ? '표시' : '숨김' }}</p>
                <p>{{ descriptions[review.state] }}</p>
                <p>사유: {{ review.reason }}</p>
                <Button data-testid="confirm-save" label="확인하고 저장" :disabled="saving" @click="save" />
            </section>
        </section>
        <section v-if="settings" data-testid="planned-modules" class="module-card">
            <span class="eyebrow">준비 중인 모듈</span>
            <h2>
                준비 중인 모듈 <small>{{ planned.length }}</small>
            </h2>
            <p>아래 모듈은 아직 제공되지 않으며 활성화할 수 없습니다.</p>
            <ul class="planned-list">
                <li v-for="module in planned" :key="module.key">
                    <span>{{ module.label }}</span
                    ><span class="planned-badge">준비 중</span>
                </li>
            </ul>
        </section>
    </main>
</template>
<style scoped>
.hr-modules {
    max-width: 1100px;
    margin: auto;
    display: grid;
    gap: 1.5rem;
    color: var(--text-color);
}
h1 {
    font-size: 1.8rem;
    margin: 0.4rem 0;
}
h2 {
    font-size: 1.25rem;
    margin: 0.4rem 0;
}
h3 {
    font-size: 1rem;
}
.eyebrow {
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    color: var(--text-color-secondary);
    font-weight: 700;
}
p {
    line-height: 1.7;
    color: var(--text-color-secondary);
}
.module-card {
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: 12px;
    padding: 1.5rem;
}
.company-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
}
.company-bar select {
    flex: 1;
}
.module-heading,
.facts {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}
.facts {
    justify-content: flex-start;
    flex-wrap: wrap;
    padding: 1rem 0;
}
.facts span {
    padding-right: 1.5rem;
}
.state-badge,
.planned-badge {
    background: var(--surface-100);
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    font-size: 0.8rem;
}
.module-note,
.change-review {
    background: var(--surface-ground);
    padding: 1rem;
    border-radius: 8px;
}
.error {
    color: var(--red-600);
}
fieldset {
    border: 0;
    padding: 0;
    display: grid;
    gap: 0.7rem;
    margin-top: 1.5rem;
}
legend {
    font-weight: 700;
    margin-bottom: 1rem;
}
select,
textarea {
    width: 100%;
    border: 1px solid var(--surface-border);
    background: var(--surface-card);
    color: var(--text-color);
    padding: 0.75rem;
    border-radius: 6px;
    font: inherit;
}
fieldset select {
    max-width: 420px;
}
fieldset p {
    margin: 0;
}
.check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
}
.hint {
    font-size: 0.85rem;
}
fieldset button {
    justify-self: start;
    margin-top: 0.5rem;
}
.change-review {
    margin-top: 1.5rem;
}
.planned-list {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7rem;
}
.planned-list li {
    border: 1px solid var(--surface-border);
    padding: 0.85rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
}
small {
    color: var(--text-color-secondary);
}
@media (max-width: 700px) {
    .company-bar {
        align-items: stretch;
        flex-direction: column;
    }
    .planned-list {
        grid-template-columns: 1fr;
    }
    .module-card {
        padding: 1rem;
    }
    .facts {
        gap: 0.5rem;
    }
}
</style>
