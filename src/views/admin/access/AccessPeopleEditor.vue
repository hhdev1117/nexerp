<script setup>
import { computed, ref } from 'vue';
import { ACTIONS, SCOPES } from '@/data/enterpriseAccess';
import AccessPermissionGrid from './AccessPermissionGrid.vue';
const props = defineProps({ modelValue: { type: Object, required: true }, resources: { type: Array, required: true }, accounts: { type: Array, default: () => [] }, sites: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);
const policy = computed(() => props.modelValue);
const linkedMembers = computed(() => policy.value.members.filter((member) => member.id));
const selectedRole = ref('');
const role = computed(() => policy.value.roles.find((item) => item.id === selectedRole.value));
const levelOptions = computed(() => [{ value: null, label: '직급·직책에서 자동' }, ...policy.value.levels.map((level) => ({ value: level.id, label: '레벨 ' + level.id + ' · ' + level.name }))]);
const siteOptions = computed(() => [{ value: '', label: '지정 안 함' }, ...props.sites.map((site) => ({ value: site.id, label: site.name }))]);
const roleOptions = computed(() => [{ value: '', label: '역할 선택' }, ...policy.value.roles.map((item) => ({ value: item.id, label: item.name }))]);
const actorOptions = computed(() => [{ value: '', label: '선택' }, ...linkedMembers.value.map((member) => ({ value: member.id, label: member.name }))]);
const resourceOptions = computed(() => props.resources.map((resource) => ({ value: resource.key, label: resource.label })));
const actionOptions = Object.entries(ACTIONS).map(([value, label]) => ({ value, label }));
const scopeOptions = Object.entries(SCOPES).map(([value, label]) => ({ value, label }));
const effectOptions = [
    { value: 'deny', label: '제한' },
    { value: 'allow', label: '허용' }
];
function accountOptions(member) {
    const options = [{ value: '', label: '계정 선택' }];
    if (member.id && !props.accounts.some((item) => item.id === member.id)) options.push({ value: member.id, label: member.name + ' (계정 확인 필요)' });
    return [
        ...options,
        ...props.accounts.map((account) => ({
            value: account.id,
            label: (account.displayName || account.email) + ' · ' + account.email,
            disabled: policy.value.members.some((item) => item !== member && item.id === account.id)
        }))
    ];
}
function addMember() {
    emit('update:modelValue', { ...policy.value, members: [...policy.value.members, { id: '', name: '', grade: '', position: '', level: null, organizationId: '', siteId: '', active: true, from: new Date().toISOString().slice(0, 10), to: null }] });
}
function addRole() {
    const id = crypto.randomUUID();
    policy.value.roles.push({ id, name: '새 업무 역할', permissions: [], members: [] });
    selectedRole.value = id;
}
function addOverride() {
    policy.value.overrides.push({ actorId: '', resource: props.resources[0]?.key || '', action: 'read', scope: 'self', effect: 'deny', from: new Date().toISOString().slice(0, 10), to: null });
}
function selectAccount(member, id) {
    if (member.id && (policy.value.roles.some((item) => item.members.includes(member.id)) || policy.value.overrides.some((item) => item.actorId === member.id))) {
        return;
    }
    const account = props.accounts.find((item) => item.id === id);
    member.id = id;
    member.name = account?.displayName || account?.email || '';
}
function linked(member) {
    return Boolean(member.id) && (policy.value.roles.some((item) => item.members.includes(member.id)) || policy.value.overrides.some((item) => item.actorId === member.id));
}
function removeMember(index) {
    const member = policy.value.members[index];
    if (linked(member) && !window.confirm('이 사용자의 업무 역할 연결과 개별 예외도 함께 제거하시겠습니까?')) return;
    policy.value.roles.forEach((item) => {
        item.members = item.members.filter((id) => id !== member.id);
    });
    policy.value.overrides = policy.value.overrides.filter((item) => item.actorId !== member.id);
    policy.value.members.splice(index, 1);
}
</script>
<template>
    <div>
        <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
                <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">사용자 연결</h2>
                <div class="mt-1 text-muted-color">등록된 계정을 선택하고 직급·직책을 연결합니다.</div>
            </div>
            <Button type="button" label="사용자 연결 추가" icon="pi pi-user-plus" size="small" @click="addMember" />
        </div>
        <p class="mb-4 text-sm text-muted-color">인사 원장 연결 전의 권한 전환 준비 자료입니다. 회사·사용자 연결을 검토한 뒤 저장하세요.</p>

        <p v-if="!policy.members.length" class="p-8 text-center border border-dashed rounded-border border-surface-300 dark:border-surface-600 text-muted-color">연결한 사용자가 없습니다. 기존 관리자를 대표로 자동 연결하지 않습니다.</p>

        <div v-for="(member, index) in policy.members" :key="index" class="p-4 mb-4 border rounded-border border-surface-200 dark:border-surface-700">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                <strong>{{ member.name || '사용자 ' + (index + 1) }}</strong>
                <Button type="button" label="연결 제거" icon="pi pi-trash" size="small" severity="danger" outlined :aria-label="(member.name || index + 1) + ' 사용자 연결 제거'" @click="removeMember(index)" />
            </div>
            <div class="grid grid-cols-12 gap-4">
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-4">
                    <label :id="'member-account-label-' + index" :for="'member-account-' + index" class="text-sm font-medium">사용자 계정</label>
                    <Select
                        :inputId="'member-account-' + index"
                        :modelValue="member.id"
                        :options="accountOptions(member)"
                        optionLabel="label"
                        optionValue="value"
                        :optionDisabled="(option) => option.disabled"
                        :ariaLabelledby="'member-account-label-' + index"
                        :disabled="linked(member)"
                        fluid
                        @update:modelValue="selectAccount(member, $event)"
                    />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-4">
                    <label :for="'member-name-' + index" class="text-sm font-medium">이름</label>
                    <InputText :id="'member-name-' + index" v-model.trim="member.name" maxlength="100" fluid />
                </div>
                <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                    <label :for="'member-grade-' + index" class="text-sm font-medium">직급 코드</label>
                    <InputText :id="'member-grade-' + index" v-model.trim="member.grade" fluid />
                </div>
                <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                    <label :for="'member-position-' + index" class="text-sm font-medium">직책 코드</label>
                    <InputText :id="'member-position-' + index" v-model.trim="member.position" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-4">
                    <label :id="'member-level-label-' + index" :for="'member-level-' + index" class="text-sm font-medium">기본등급</label>
                    <Select :inputId="'member-level-' + index" v-model="member.level" :options="levelOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'member-level-label-' + index" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-4">
                    <label :for="'member-organization-' + index" class="text-sm font-medium">조직 코드</label>
                    <InputText :id="'member-organization-' + index" v-model.trim="member.organizationId" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-4">
                    <label :id="'member-site-label-' + index" :for="'member-site-' + index" class="text-sm font-medium">사업장</label>
                    <Select :inputId="'member-site-' + index" v-model="member.siteId" :options="siteOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'member-site-label-' + index" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                    <label :for="'member-from-' + index" class="text-sm font-medium">시작일</label>
                    <InputText :id="'member-from-' + index" v-model="member.from" type="date" fluid />
                </div>
                <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-3">
                    <label :for="'member-to-' + index" class="text-sm font-medium">종료일 (당일 제외)</label>
                    <InputText :id="'member-to-' + index" v-model="member.to" type="date" fluid />
                </div>
                <div class="flex items-center col-span-12 gap-3 xl:col-span-3">
                    <Checkbox :inputId="'member-active-' + index" v-model="member.active" binary />
                    <label :for="'member-active-' + index" class="text-sm font-medium">활성 연결</label>
                </div>
            </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mt-8 mb-2">
            <div>
                <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">담당 업무 권한</h2>
                <div class="mt-1 text-muted-color">기본등급과 별개로 인사·급여·구매 등 업무 역할을 추가합니다.</div>
            </div>
            <Button type="button" label="업무 역할 추가" icon="pi pi-plus" size="small" @click="addRole" />
        </div>
        <div class="flex flex-col gap-2 mb-4 sm:max-w-sm">
            <label id="role-select-label" for="role-select" class="text-sm font-medium">편집할 업무 역할</label>
            <Select inputId="role-select" v-model="selectedRole" :options="roleOptions" optionLabel="label" optionValue="value" ariaLabelledby="role-select-label" fluid />
        </div>

        <div v-if="role" class="p-4 mb-4 border rounded-border border-surface-200 dark:border-surface-700">
            <div class="flex flex-col gap-2 mb-4 sm:max-w-sm">
                <label for="role-name" class="text-sm font-medium">역할 이름</label>
                <InputText id="role-name" v-model.trim="role.name" fluid />
            </div>
            <fieldset class="p-4 mb-4 border rounded-border border-surface-200 dark:border-surface-700">
                <legend class="px-2 text-sm font-medium">연결 사용자</legend>
                <div class="flex flex-wrap gap-4">
                    <div v-for="member in linkedMembers" :key="member.id" class="flex items-center gap-2">
                        <Checkbox :inputId="'role-member-' + member.id" v-model="role.members" :value="member.id" />
                        <label :for="'role-member-' + member.id">{{ member.name }}</label>
                    </div>
                </div>
            </fieldset>
            <AccessPermissionGrid v-model="role.permissions" :resources="resources" />
            <Button
                type="button"
                label="업무 역할 제거"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                outlined
                class="mt-4"
                @click="
                    policy.roles.splice(policy.roles.indexOf(role), 1);
                    selectedRole = '';
                "
            />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mt-8 mb-2">
            <div>
                <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">개별 허용·제한</h2>
                <div class="mt-1 text-muted-color">같은 행동·대상 범위에서는 개별 제한이 허용보다 우선합니다.</div>
            </div>
            <Button type="button" label="예외 추가" icon="pi pi-plus" size="small" @click="addOverride" />
        </div>

        <div v-for="(override, index) in policy.overrides" :key="index" class="grid grid-cols-12 gap-4 py-4 border-b border-surface-200 dark:border-surface-700">
            <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-2">
                <label :id="'override-actor-label-' + index" :for="'override-actor-' + index" class="text-sm font-medium">사용자</label>
                <Select :inputId="'override-actor-' + index" v-model="override.actorId" :options="actorOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'override-actor-label-' + index" fluid />
            </div>
            <div class="flex flex-col col-span-12 gap-2 md:col-span-6 xl:col-span-2">
                <label :id="'override-resource-label-' + index" :for="'override-resource-' + index" class="text-sm font-medium">메뉴</label>
                <Select :inputId="'override-resource-' + index" v-model="override.resource" :options="resourceOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'override-resource-label-' + index" fluid />
            </div>
            <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                <label :id="'override-action-label-' + index" :for="'override-action-' + index" class="text-sm font-medium">행동</label>
                <Select :inputId="'override-action-' + index" v-model="override.action" :options="actionOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'override-action-label-' + index" fluid />
            </div>
            <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                <label :id="'override-scope-label-' + index" :for="'override-scope-' + index" class="text-sm font-medium">범위</label>
                <Select :inputId="'override-scope-' + index" v-model="override.scope" :options="scopeOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'override-scope-label-' + index" fluid />
            </div>
            <div class="flex flex-col col-span-6 gap-2 xl:col-span-2">
                <label :id="'override-effect-label-' + index" :for="'override-effect-' + index" class="text-sm font-medium">효과</label>
                <Select :inputId="'override-effect-' + index" v-model="override.effect" :options="effectOptions" optionLabel="label" optionValue="value" :ariaLabelledby="'override-effect-label-' + index" fluid />
            </div>
            <div class="flex flex-col col-span-6 gap-2 xl:col-span-1">
                <label :for="'override-from-' + index" class="text-sm font-medium">시작일</label>
                <InputText :id="'override-from-' + index" v-model="override.from" type="date" fluid />
            </div>
            <div class="flex flex-col col-span-6 gap-2 xl:col-span-1">
                <label :for="'override-to-' + index" class="text-sm font-medium">종료일</label>
                <InputText :id="'override-to-' + index" v-model="override.to" type="date" fluid />
            </div>
            <div class="flex items-end col-span-6 xl:col-span-12">
                <Button type="button" label="제거" icon="pi pi-trash" size="small" severity="danger" outlined :aria-label="'예외 ' + (index + 1) + ' 제거'" @click="policy.overrides.splice(index, 1)" />
            </div>
        </div>
    </div>
</template>
