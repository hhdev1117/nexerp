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
const asOf = ref(new Date().toISOString().slice(0, 10));
let loadSequence = 0;
const dirty = computed(() => policy.value && JSON.stringify(policy.value) !== baseline.value);
const selectedLevel = computed(() => policy.value?.levels.find((level) => level.id === levelId.value));
const companyOptions = computed(() => [{ value: '', label: '회사를 선택해 주세요' }, ...adminCompanies.value.map((company) => ({ value: company.id, label: company.name }))]);
const levelOptions = computed(() => (policy.value?.levels || []).map((level) => ({ value: level.id, label: '레벨 ' + level.id + ' · ' + level.name })));
const memberOptions = computed(() => [{ value: '', label: '사용자 선택' }, ...(policy.value?.members || []).map((member) => ({ value: member.id, label: member.name }))]);
const targetOptions = computed(() => [{ value: '', label: '선택 사용자 본인' }, ...(policy.value?.members || []).map((member) => ({ value: member.id, label: member.name }))]);
const previewActionOptions = Object.entries(ACTIONS).map(([value, label]) => ({ value, label }));
const mappingKindOptions = [
    { value: 'grade', label: '직급' },
    { value: 'position', label: '직책' }
];
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
function changeCompany(value) {
    if (!canLeave()) return;
    companyId.value = value;
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
    try {
        accounts.value = await adminApi.listAccounts();
    } catch {
        accountsError.value = '사용자 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
    }
}
function beforeUnload(event) {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = '';
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
    try {
        adminCompanies.value = await runtimeRepository.listAdminCompanies();
    } catch {
        catalogError.value = '회사 목록을 불러오지 못했습니다. 권한 데이터베이스 적용 상태와 인증을 확인해 주세요.';
    }
}
async function publicationChanged() {
    await runtime.refresh(auth.user.value?.id, runtime.context.value?.companyId || companyId.value);
    notice.value = '적용 정책을 변경했습니다. 사용자 접근은 서버에서 최신 정책으로 확인합니다.';
}
</script>
<template>
    <div>
        <div class="flex flex-col gap-4 mb-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
                <p class="m-0 text-sm text-muted-color">시스템 · 접근 제어</p>
                <h1 class="mt-1 text-2xl font-semibold text-surface-900 dark:text-surface-0">전사 권한관리</h1>
                <div class="mt-1 text-muted-color">직급과 직책을 권한등급에 연결하고, 사용자별 허용 범위를 확인합니다.</div>
            </div>
            <div class="flex flex-col gap-2 xl:w-80">
                <label id="access-company-label" for="access-company" class="text-sm font-medium">관리할 회사</label>
                <Select inputId="access-company" :modelValue="companyId" :options="companyOptions" optionLabel="label" optionValue="value" ariaLabelledby="access-company-label" :disabled="saving" fluid @update:modelValue="changeCompany" />
            </div>
        </div>

        <div class="p-4 mb-4 border-l-4 rounded-border border-primary bg-surface-50 dark:bg-surface-800">
            <strong>초안과 실제 적용 분리</strong> 설정을 저장한 뒤 적용 관리에서 검토·적용합니다. 적용 전에는 기존 업무 권한을 사용하고, 적용 후에는 메뉴와 회사·사업장 데이터 접근에 새 정책을 사용합니다.
        </div>
        <p class="mb-6 text-sm text-muted-color">
            직원 계정이 인사 원장에 연결되면 현재 직급·직책·소속을 자동 반영합니다. 직접 지정한 등급은 계속 우선하며 퇴직 적용일 이후에는 해당 회사 접근이 종료됩니다. 인사 원장의 생성·수정 권한은 직원 연결과 발령으로 업무 권한을 바꿀 수 있으므로
            신뢰하는 인사담당자에게만 부여해 주세요.
        </p>

        <div v-if="catalogError" role="alert" class="mb-4">
            <Message severity="error" :closable="false" class="mb-3">{{ catalogError }}</Message>
            <Button type="button" label="회사 목록 다시 불러오기" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="loadCatalog" />
        </div>
        <div v-if="error" role="alert" class="mb-4">
            <Message severity="error" :closable="false" class="mb-3">{{ error }}</Message>
            <Button v-if="!policy" type="button" label="다시 불러오기" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="loadPolicy" />
        </div>
        <Button v-if="conflict" type="button" label="내 변경을 취소하고 최신 설정 불러오기" icon="pi pi-history" size="small" severity="secondary" outlined class="mb-4" @click="reloadAfterConflict" />
        <Message v-if="notice" severity="success" :closable="false" class="mb-4" role="status">{{ notice }}</Message>

        <div v-if="loading" role="status" class="p-12 text-center card text-muted-color">권한 설정을 불러오는 중입니다.</div>
        <div v-else-if="!companyId" class="p-12 text-center card text-muted-color">회사를 선택하면 권한등급과 연결 정보를 관리할 수 있습니다.</div>

        <section v-if="policy && !loading" data-testid="policy-editor" class="mb-6 card">
            <fieldset :disabled="saving" class="p-0 m-0 border-0">
                <legend class="sr-only">권한 정책 편집</legend>
                <Tabs :value="tab" @update:value="tab = $event">
                    <TabList>
                        <Tab v-for="(label, index) in tabs" :key="label" :value="index">{{ label }}</Tab>
                    </TabList>
                    <TabPanels>
                        <TabPanel :value="0">
                            <div class="grid grid-cols-12 gap-6">
                                <aside class="col-span-12 lg:col-span-3" aria-label="권한등급 선택">
                                    <div class="flex flex-row flex-wrap gap-2 lg:flex-col">
                                        <button
                                            v-for="level in policy.levels"
                                            :key="level.id"
                                            type="button"
                                            class="flex flex-col flex-1 gap-1 p-4 text-left transition-colors border cursor-pointer rounded-border"
                                            :class="level.id === levelId ? 'border-primary bg-primary-50 dark:bg-primary-400/10' : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800'"
                                            :aria-pressed="level.id === levelId"
                                            @click="levelId = level.id"
                                        >
                                            <strong>레벨 {{ level.id }}</strong>
                                            <span class="text-muted-color">{{ level.name }}</span>
                                        </button>
                                    </div>
                                </aside>
                                <div v-if="selectedLevel" class="col-span-12 lg:col-span-9">
                                    <div class="flex flex-col gap-2 mb-2 sm:max-w-sm">
                                        <label for="level-name" class="text-sm font-medium">등급 이름</label>
                                        <InputText id="level-name" v-model.trim="selectedLevel.name" maxlength="60" fluid />
                                    </div>
                                    <p class="mb-4 text-sm text-muted-color">숫자만으로 권한을 상속하지 않습니다. 행동별 범위를 직접 지정합니다.</p>
                                    <AccessPermissionGrid v-model="selectedLevel.permissions" :resources="resources" />
                                </div>
                            </div>
                        </TabPanel>

                        <TabPanel :value="1">
                            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                                <div>
                                    <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">직급·직책 연결</h2>
                                    <div class="mt-1 text-muted-color">직책이 직급보다 우선합니다. 대리이면서 팀장이면 팀장 등급을 적용합니다.</div>
                                </div>
                                <Button type="button" label="연결 추가" icon="pi pi-plus" size="small" @click="addMapping" />
                            </div>
                            <p v-if="!policy.mappings.length" class="p-8 text-center border border-dashed rounded-border border-surface-300 dark:border-surface-600 text-muted-color">
                                등록된 연결이 없습니다. 사원·대리·팀장·대표를 회사 기준에 맞게 연결해 주세요.
                            </p>
                            <div v-for="(mapping, index) in policy.mappings" :key="index" class="grid grid-cols-12 gap-4 py-4 border-b border-surface-200 dark:border-surface-700">
                                <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                                    <label :id="'mapping-kind-label-' + index" :for="'mapping-kind-' + index" class="text-sm font-medium">구분</label>
                                    <Select :inputId="'mapping-kind-' + index" v-model="mapping.kind" :options="mappingKindOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'mapping-kind-label-' + index" fluid />
                                </div>
                                <div class="flex flex-col col-span-6 gap-2 xl:col-span-3">
                                    <label :for="'mapping-code-' + index" class="text-sm font-medium">직급·직책 코드</label>
                                    <InputText :id="'mapping-code-' + index" v-model.trim="mapping.code" maxlength="60" fluid />
                                </div>
                                <div class="flex flex-col col-span-12 gap-2 xl:col-span-3">
                                    <label :id="'mapping-level-label-' + index" :for="'mapping-level-' + index" class="text-sm font-medium">연결 등급</label>
                                    <Select :inputId="'mapping-level-' + index" v-model="mapping.level" :options="levelOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'mapping-level-label-' + index" fluid />
                                </div>
                                <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                                    <label :for="'mapping-from-' + index" class="text-sm font-medium">시작일</label>
                                    <InputText :id="'mapping-from-' + index" v-model="mapping.from" type="date" fluid />
                                </div>
                                <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                                    <label :for="'mapping-to-' + index" class="text-sm font-medium">종료일 (당일 제외)</label>
                                    <InputText :id="'mapping-to-' + index" v-model="mapping.to" type="date" fluid />
                                </div>
                                <div class="flex items-end col-span-12">
                                    <Button type="button" label="제거" icon="pi pi-trash" size="small" severity="danger" outlined :aria-label="(mapping.code || index + 1) + ' 연결 제거'" @click="policy.mappings.splice(index, 1)" />
                                </div>
                            </div>
                        </TabPanel>

                        <TabPanel :value="2">
                            <div v-if="accountsError" role="alert" class="mb-4">
                                <Message severity="error" :closable="false" class="mb-3">{{ accountsError }}</Message>
                                <Button type="button" label="사용자 다시 불러오기" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="loadAccounts" />
                            </div>
                            <AccessPeopleEditor v-model="policy" :resources="resources" :accounts="accounts" :sites="adminSites" />
                        </TabPanel>

                        <TabPanel :value="3">
                            <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">최종 권한 확인</h2>
                            <p class="mt-1 mb-4 text-sm text-muted-color">
                                편집 중인 정책에서 선택한 사용자의 자료 접근을 계산합니다. 계정 활성·AAL2·모듈 사용을 가정한 미리보기입니다. 연결된 직원의 현재 인사발령, 문서별 배정·하위 조직·결재 상태는 포함하지 않습니다. 실제 접근은 서버에서 현재
                                인사 원장을 반영해 판정합니다.
                            </p>
                            <div class="grid grid-cols-12 gap-4 mb-4">
                                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                                    <label id="preview-actor-label" for="preview-actor" class="text-sm font-medium">사용자</label>
                                    <Select inputId="preview-actor" v-model="actorId" :options="memberOptions" optionLabel="label" optionValue="value" ariaLabelledby="preview-actor-label" fluid />
                                </div>
                                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                                    <label for="preview-as-of" class="text-sm font-medium">기준일</label>
                                    <InputText id="preview-as-of" v-model="asOf" type="date" fluid />
                                </div>
                                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                                    <label id="preview-action-label" for="preview-action" class="text-sm font-medium">확인할 행동</label>
                                    <Select inputId="preview-action" v-model="previewAction" :options="previewActionOptions" optionLabel="label" optionValue="value" ariaLabelledby="preview-action-label" fluid />
                                </div>
                                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                                    <label id="preview-target-label" for="preview-target" class="text-sm font-medium">자료 대상</label>
                                    <Select inputId="preview-target" v-model="targetId" :options="targetOptions" optionLabel="label" optionValue="value" ariaLabelledby="preview-target-label" fluid />
                                </div>
                            </div>
                            <div v-for="item in preview" :key="item.key" class="flex flex-wrap items-center gap-4 py-3 border-b border-surface-200 dark:border-surface-700">
                                <strong class="min-w-[9rem]">{{ item.label }}</strong>
                                <Tag :value="item.result.allowed ? '허용' : '제한'" :severity="item.result.allowed ? 'success' : 'secondary'" />
                                <span class="text-muted-color">{{ item.result.reason }}</span>
                            </div>
                        </TabPanel>
                    </TabPanels>
                </Tabs>
            </fieldset>

            <section v-if="reviewing" aria-label="변경 영향 확인" class="p-5 mt-6 border-2 rounded-border border-primary">
                <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">변경 내용 확인</h2>
                <p class="mt-1">초안의 저장 내용입니다. 이 단계에서는 실제 적용 정책을 변경하지 않습니다.</p>
                <ul class="pl-5">
                    <li v-for="change in changes" :key="change.label">{{ change.label }} 변경 · 항목 {{ change.before }} → {{ change.after }}개</li>
                </ul>
                <p v-for="member in impact" :key="member.id" class="m-0">{{ member.name }}: 레벨 {{ member.before ?? '미배정' }} → {{ member.after ?? '미배정' }}</p>
                <p class="mt-3 text-sm text-muted-color">같은 등급 내 행동·범위 변경도 연결 사용자에게 영향을 줍니다. 최종 권한 확인 탭에서 검토할 수 있습니다.</p>
                <div class="flex flex-col gap-2 mb-4">
                    <label for="change-reason" class="font-medium">변경 사유 (필수)</label>
                    <Textarea id="change-reason" v-model="reason" maxlength="500" :disabled="saving" rows="2" fluid />
                </div>
                <Button type="button" :label="saving ? '저장 중…' : '검토한 설정 저장'" icon="pi pi-check" :disabled="saving || !reason.trim()" @click="save" />
            </section>

            <footer class="flex flex-wrap items-center justify-between gap-3 pt-4 mt-6 border-t border-surface-200 dark:border-surface-700">
                <span class="text-sm text-muted-color">저장 버전 {{ revision }} · {{ dirty ? '저장하지 않은 변경 있음' : '변경 없음' }}</span>
                <div class="flex flex-wrap gap-2">
                    <Button type="button" label="되돌리기" icon="pi pi-undo" severity="secondary" outlined :disabled="!dirty || saving" @click="reset" />
                    <Button type="button" label="변경 내용 확인" icon="pi pi-eye" :disabled="(!dirty && revision !== 0) || saving" @click="review" />
                </div>
            </footer>
        </section>

        <AccessPublication v-if="policy && companyId" :company-id="companyId" :draft-revision="revision" :dirty="Boolean(dirty) || saving" @changed="publicationChanged" />
    </div>
</template>
