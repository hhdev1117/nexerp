<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { erpMenu, flattenMenuRoutes } from '@/data/erp';
import { ACTIONS, createDefaultPolicy, explainAccess, resolveLevel, validatePolicy } from '@/data/enterpriseAccess';
import { createEnterpriseAccessRepository } from '@/repositories/access/enterpriseAccessRepository';
import { createEnterpriseRuntimeRepository } from '@/repositories/access/enterpriseRuntimeRepository';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { useAuthStore } from '@/stores/auth';
import { useAdminApi } from '@/services/adminApi';
import AccessPermissionGrid from './access/AccessPermissionGrid.vue';
import AccessPeopleEditor from './access/AccessPeopleEditor.vue';
import AccessPublication from './access/AccessPublication.vue';

const runtimeRepository = createEnterpriseRuntimeRepository();
const runtime = useEnterpriseRuntimeStore();
const auth = useAuthStore();
const adminCompanies = ref([]);
const adminSites = ref([]);
const catalogError = ref('');
const repository = createEnterpriseAccessRepository();
const adminApi = useAdminApi();
const accounts = ref([]);
const accountsError = ref('');
const resources = flattenMenuRoutes(erpMenu).map((item) => ({ key: item.menuKey, label: item.label }));
const tabs = ['권한등급', '직급·직책 매핑', '사용자 권한', '최종 권한 확인'];
const companyId = ref('');
const policy = ref(null);
const baseline = ref('');
const revision = ref(0);
const tab = ref(0);
const levelId = ref(1);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const conflict = ref(false);
const notice = ref('');
const reviewing = ref(false);
const reason = ref('');
const actorId = ref('');
const targetId = ref('');
const previewAction = ref('read');
const previewActions = ACTIONS;
const asOf = ref(new Date().toISOString().slice(0, 10));
let loadSequence = 0;
const dirty = computed(() => policy.value && JSON.stringify(policy.value) !== baseline.value);
const selectedLevel = computed(() => policy.value?.levels.find((level) => level.id === levelId.value));
const changes = computed(() => {
    if (!policy.value || !baseline.value) return [];
    const before = JSON.parse(baseline.value);
    return [
        ['levels', '권한등급'],
        ['mappings', '직급·직책 매핑'],
        ['members', '사용자 연결'],
        ['roles', '업무 역할'],
        ['overrides', '개별 예외']
    ]
        .filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(policy.value[key]))
        .map(([key, label]) => ({ label, before: before[key]?.length || 0, after: policy.value[key]?.length || 0 }));
});
const impact = computed(() => {
    if (!policy.value || !baseline.value) return [];
    const previous = JSON.parse(baseline.value);
    const members = [...policy.value.members, ...previous.members.filter((member) => !policy.value.members.some((current) => current.id === member.id))];
    return members
        .map((member) => {
            const old = previous.members.find((item) => item.id === member.id);
            const before = old ? resolveLevel(previous, old, asOf.value).level : null;
            const after = policy.value.members.some((current) => current.id === member.id) ? resolveLevel(policy.value, member, asOf.value).level : null;
            return { id: member.id, name: member.name, before, after };
        })
        .filter((item) => item.before !== item.after);
});
const preview = computed(() => {
    if (!actorId.value || !policy.value) return [];
    const target = policy.value.members.find((member) => member.id === (targetId.value || actorId.value));
    return resources.map((resource) => ({
        ...resource,
        result: explainAccess(policy.value, {
            actorId: actorId.value,
            companyId: companyId.value,
            policyCompanyId: companyId.value,
            resource: resource.key,
            action: previewAction.value,
            subjectId: target?.id,
            organizationId: target?.organizationId,
            siteId: target?.siteId,
            asOf: asOf.value,
            active: true,
            aal: 2,
            moduleState: 'enabled'
        })
    }));
});

async function loadPolicy() {
    const sequence = ++loadSequence;
    policy.value = null;
    baseline.value = '';
    error.value = '';
    notice.value = '';
    reviewing.value = false;
    actorId.value = '';
    targetId.value = '';
    loading.value = false;
    conflict.value = false;
    adminSites.value = [];
    if (!companyId.value) return;
    loading.value = true;
    try {
        const [row, sites] = await Promise.all([repository.load(companyId.value), runtimeRepository.listAdminSites(companyId.value)]);
        if (sequence !== loadSequence) return;
        policy.value = row.policy || createDefaultPolicy(resources);
        adminSites.value = sites;
        baseline.value = JSON.stringify(policy.value);
        revision.value = row.revision;
        reason.value = '';
    } catch (cause) {
        if (sequence === loadSequence) error.value = cause.message || '권한을 불러오지 못했습니다.';
    } finally {
        if (sequence === loadSequence) loading.value = false;
    }
}
function canLeave() {
    if (saving.value) return false;
    return !dirty.value || window.confirm('저장하지 않은 권한 변경을 취소하고 이동하시겠습니까?');
}
function changeCompany(event) {
    if (!canLeave()) {
        event.target.value = companyId.value;
        return;
    }
    companyId.value = event.target.value;
    loadPolicy();
}
function reset() {
    if (!window.confirm('편집한 내용을 마지막 저장 상태로 되돌리시겠습니까?')) return;
    policy.value = JSON.parse(baseline.value);
    reviewing.value = false;
    error.value = '';
}
async function review() {
    error.value = '';
    try {
        validatePolicy(policy.value, resources);
        reviewing.value = true;
        await nextTick();
        document.getElementById('change-reason')?.focus();
    } catch (cause) {
        error.value = cause.message;
    }
}
async function save() {
    error.value = '';
    if (!reason.value.trim()) {
        error.value = '변경 사유를 입력해 주세요.';
        return;
    }
    saving.value = true;
    try {
        validatePolicy(policy.value, resources);
        const row = await repository.save(companyId.value, policy.value, revision.value, reason.value.trim());
        policy.value = row.policy;
        revision.value = row.revision;
        baseline.value = JSON.stringify(row.policy);
        reviewing.value = false;
        reason.value = '';
        notice.value = `권한 초안 버전 ${row.revision}을 저장했습니다. 실제 적용은 아래 적용 관리에서 진행합니다.`;
    } catch (cause) {
        conflict.value = cause.code === 'revision_conflict';
        error.value = cause.message || '저장하지 못했습니다. 편집 내용은 유지됩니다.';
    } finally {
        saving.value = false;
    }
}
function reloadAfterConflict() {
    if (!canLeave()) return;
    loadPolicy();
}
function addMapping() {
    policy.value.mappings.push({ kind: 'grade', code: '', level: 1, from: asOf.value, to: null });
}
async function loadAccounts() {
    accountsError.value = '';
    try { accounts.value = await adminApi.listAccounts(); }
    catch { accountsError.value = '사용자 목록을 불러오지 못했습니다. 다시 시도해 주세요.'; }
}
function beforeUnload(event) {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = '';
}
function tabKey(event, index) {
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    else return;
    event.preventDefault();
    tab.value = target;
    document.getElementById(`access-tab-${target}`)?.focus();
}
watch(
    policy,
    () => {
        reviewing.value = false;
        notice.value = '';
    },
    { deep: true, flush: 'sync' }
);
onBeforeRouteLeave(() => canLeave());
onMounted(() => {
    loadCatalog();
    loadAccounts();
    window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
    ++loadSequence;
    window.removeEventListener('beforeunload', beforeUnload);
});
async function loadCatalog() {
    catalogError.value = '';
    try { adminCompanies.value = await runtimeRepository.listAdminCompanies(); }
    catch { catalogError.value = '회사 목록을 불러오지 못했습니다. 권한 데이터베이스 적용 상태와 인증을 확인해 주세요.'; }
}
async function publicationChanged() {
    await runtime.refresh(auth.user.value?.id, runtime.context.value?.companyId || companyId.value);
    notice.value = '적용 정책을 변경했습니다. 사용자 접근은 서버에서 최신 정책으로 확인합니다.';
}
</script>

<template>
    <main class="access-page">
        <header class="access-heading">
            <div>
                <p class="eyebrow">시스템 · 접근 제어</p>
                <h1>전사 권한관리</h1>
                <p>직급과 직책을 권한등급에 연결하고, 사용자별 허용 범위를 확인합니다.</p>
            </div>
            <div>
                <label for="access-company">관리할 회사</label
                ><select id="access-company" :value="companyId" :disabled="saving" @change="changeCompany">
                    <option value="">회사를 선택해 주세요</option>
                    <option v-for="company in adminCompanies" :key="company.id" :value="company.id">{{ company.name }}</option>
                </select>
            </div>
        </header>
        <p class="access-banner"><strong>초안과 실제 적용 분리</strong> 설정을 저장한 뒤 적용 관리에서 검토·적용합니다. 적용 전에는 기존 업무 권한을 사용하고, 적용 후에는 메뉴와 회사·사업장 데이터 접근에 새 정책을 사용합니다.</p>
        <p class="access-help">직원 계정이 인사 원장에 연결되면 현재 직급·직책·소속을 자동 반영합니다. 직접 지정한 등급은 계속 우선하며 퇴직 적용일 이후에는 해당 회사 접근이 종료됩니다. 인사 원장의 생성·수정 권한은 직원 연결과 발령으로 업무 권한을 바꿀 수 있으므로 신뢰하는 인사담당자에게만 부여해 주세요.</p>
        <p v-if="catalogError" role="alert">{{ catalogError }} <button type="button" @click="loadCatalog">회사 목록 다시 불러오기</button></p>
        <div v-if="error" role="alert" class="access-error">{{ error }} <button v-if="!policy" type="button" @click="loadPolicy">다시 불러오기</button></div>
        <button v-if="conflict" type="button" @click="reloadAfterConflict">내 변경을 취소하고 최신 설정 불러오기</button>
        <p v-if="notice" role="status" class="access-banner">{{ notice }}</p>
        <p v-if="loading" role="status" class="access-empty">권한 설정을 불러오는 중입니다.</p>
        <p v-else-if="!companyId" class="access-empty">회사를 선택하면 권한등급과 연결 정보를 관리할 수 있습니다.</p>
        <section v-if="policy && !loading" data-testid="policy-editor">
            <div class="access-tabs" role="tablist" aria-label="권한관리 작업">
                <button
                    v-for="(label, index) in tabs"
                    :id="`access-tab-${index}`"
                    :key="label"
                    role="tab"
                    :aria-selected="tab === index"
                    :aria-controls="`access-panel-${index}`"
                    :tabindex="tab === index ? 0 : -1"
                    @click="tab = index"
                    @keydown="tabKey($event, index)"
                >
                    {{ label }}
                </button>
            </div>
            <fieldset :disabled="saving" class="access-editor">
                <legend class="sr-only">권한 정책 편집</legend>
                <section v-show="tab === 0" id="access-panel-0" role="tabpanel" aria-labelledby="access-tab-0" class="access-level-layout">
                    <aside aria-label="권한등급 선택">
                        <button v-for="level in policy.levels" :key="level.id" type="button" class="level-item" :class="{ selected: level.id === levelId }" :aria-pressed="level.id === levelId" @click="levelId = level.id">
                            <strong>레벨 {{ level.id }}</strong
                            ><span>{{ level.name }}</span>
                        </button>
                    </aside>
                    <div v-if="selectedLevel">
                        <label for="level-name">등급 이름</label><input id="level-name" v-model.trim="selectedLevel.name" maxlength="60" />
                        <p class="access-help">숫자만으로 권한을 상속하지 않습니다. 행동별 범위를 직접 지정합니다.</p>
                        <AccessPermissionGrid v-model="selectedLevel.permissions" :resources="resources" />
                    </div>
                </section>
                <section v-show="tab === 1" id="access-panel-1" role="tabpanel" aria-labelledby="access-tab-1">
                    <div class="access-section-heading">
                        <div>
                            <h2>직급·직책 연결</h2>
                            <p>직책이 직급보다 우선합니다. 대리이면서 팀장이면 팀장 등급을 적용합니다.</p>
                        </div>
                        <button type="button" @click="addMapping">연결 추가</button>
                    </div>
                    <p v-if="!policy.mappings.length" class="access-empty">등록된 연결이 없습니다. 사원·대리·팀장·대표를 회사 기준에 맞게 연결해 주세요.</p>
                    <div v-for="(mapping, index) in policy.mappings" :key="index" class="access-record">
                        <label
                            >구분<select v-model="mapping.kind">
                                <option value="grade">직급</option>
                                <option value="position">직책</option>
                            </select></label
                        >
                        <label>직급·직책 코드<input v-model.trim="mapping.code" maxlength="60" /></label>
                        <label
                            >연결 등급<select v-model.number="mapping.level">
                                <option v-for="level in policy.levels" :key="level.id" :value="level.id">레벨 {{ level.id }} · {{ level.name }}</option>
                            </select></label
                        >
                        <label>시작일<input v-model="mapping.from" type="date" /></label><label>종료일 (당일 제외)<input v-model="mapping.to" type="date" /></label>
                        <button type="button" :aria-label="`${mapping.code || index + 1} 연결 제거`" @click="policy.mappings.splice(index, 1)">제거</button>
                    </div>
                </section>
                <section v-show="tab === 2" id="access-panel-2" role="tabpanel" aria-labelledby="access-tab-2"><p v-if="accountsError" role="alert">{{ accountsError }} <button type="button" @click="loadAccounts">사용자 다시 불러오기</button></p><AccessPeopleEditor v-model="policy" :resources="resources" :accounts="accounts" :sites="adminSites" /></section>
                <section v-show="tab === 3" id="access-panel-3" role="tabpanel" aria-labelledby="access-tab-3">
                    <h2>최종 권한 확인</h2>
                    <p class="access-help">편집 중인 정책에서 선택한 사용자의 자료 접근을 계산합니다. 계정 활성·AAL2·모듈 사용을 가정한 미리보기입니다. 연결된 직원의 현재 인사발령, 문서별 배정·하위 조직·결재 상태는 포함하지 않습니다. 실제 접근은 서버에서 현재 인사 원장을 반영해 판정합니다.</p>
                    <div class="access-record">
                        <label
                            >사용자<select v-model="actorId">
                                <option value="">사용자 선택</option>
                                <option v-for="member in policy.members" :key="member.id" :value="member.id">{{ member.name }}</option>
                            </select></label
                        ><label>기준일<input v-model="asOf" type="date" /></label>
                    </div>
                    <div class="access-record"><label>확인할 행동<select v-model="previewAction"><option v-for="(label, key) in previewActions" :key="key" :value="key">{{ label }}</option></select></label><label>자료 대상<select v-model="targetId"><option value="">선택 사용자 본인</option><option v-for="member in policy.members" :key="member.id" :value="member.id">{{ member.name }}</option></select></label></div>
                    <div v-for="item in preview" :key="item.key" class="access-result">
                        <strong>{{ item.label }}</strong
                        ><span class="access-status" :class="{ allowed: item.result.allowed }">{{ item.result.allowed ? '허용' : '제한' }}</span
                        ><span>{{ item.result.reason }}</span>
                    </div>
                </section>
            </fieldset>
            <section v-if="reviewing" class="access-review" aria-label="변경 영향 확인">
                <h2>변경 내용 확인</h2>
                <p>초안의 저장 내용입니다. 이 단계에서는 실제 적용 정책을 변경하지 않습니다.</p>
                <ul>
                    <li v-for="change in changes" :key="change.label">{{ change.label }} 변경 · 항목 {{ change.before }} → {{ change.after }}개</li>
                </ul>
                <p v-for="member in impact" :key="member.id">{{ member.name }}: 레벨 {{ member.before ?? '미배정' }} → {{ member.after ?? '미배정' }}</p>
                <p class="access-help">같은 등급 내 행동·범위 변경도 연결 사용자에게 영향을 줍니다. 최종 권한 확인 탭에서 검토할 수 있습니다.</p>
                <label for="change-reason">변경 사유 (필수)</label><textarea id="change-reason" v-model="reason" maxlength="500" :disabled="saving" rows="2"></textarea>
                <button type="button" class="primary" :disabled="saving || !reason.trim()" @click="save">{{ saving ? '저장 중…' : '검토한 설정 저장' }}</button>
            </section>
            <footer class="access-actions">
                <span>저장 버전 {{ revision }} · {{ dirty ? '저장하지 않은 변경 있음' : '변경 없음' }}</span>
                <div><button type="button" :disabled="!dirty || saving" @click="reset">되돌리기</button><button type="button" class="primary" :disabled="(!dirty && revision !== 0) || saving" @click="review">변경 내용 확인</button></div>
            </footer>
        </section>
        <AccessPublication v-if="policy && companyId" :company-id="companyId" :draft-revision="revision" :dirty="Boolean(dirty) || saving" @changed="publicationChanged" />
    </main>
</template>

<style src="./access/enterprise-access.css"></style>
