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
function linked(member) { return Boolean(member.id) && (policy.value.roles.some((item) => item.members.includes(member.id)) || policy.value.overrides.some((item) => item.actorId === member.id)); }
function removeMember(index) {
    const member = policy.value.members[index];
    if (linked(member) && !window.confirm('이 사용자의 업무 역할 연결과 개별 예외도 함께 제거하시겠습니까?')) return;
    policy.value.roles.forEach((item) => { item.members = item.members.filter((id) => id !== member.id); });
    policy.value.overrides = policy.value.overrides.filter((item) => item.actorId !== member.id);
    policy.value.members.splice(index, 1);
}
</script>
<template>
    <div>
        <div class="access-section-heading">
            <div>
                <h2>사용자 연결</h2>
                <p>등록된 계정을 선택하고 직급·직책을 연결합니다.</p>
            </div>
            <button type="button" @click="addMember">사용자 연결 추가</button>
        </div>
        <p class="access-help">인사 원장 연결 전의 권한 전환 준비 자료입니다. 회사·사용자 연결을 검토한 뒤 저장하세요.</p>
        <p v-if="!policy.members.length" class="access-empty">연결한 사용자가 없습니다. 기존 관리자를 대표로 자동 연결하지 않습니다.</p>
        <fieldset v-for="(member, index) in policy.members" :key="index" class="access-person">
            <legend>{{ member.name || `사용자 ${index + 1}` }}</legend>
            <div class="access-record">
                <label>사용자 계정<select :value="member.id" :disabled="linked(member)" @change="selectAccount(member, $event.target.value)"><option value="">계정 선택</option><option v-if="member.id && !accounts.some((item) => item.id === member.id)" :value="member.id">{{ member.name }} (계정 확인 필요)</option><option v-for="account in accounts" :key="account.id" :value="account.id" :disabled="policy.members.some((item) => item !== member && item.id === account.id)">{{ account.displayName || account.email }} · {{ account.email }}</option></select></label><label>이름<input v-model.trim="member.name" maxlength="100" /></label><label>직급 코드<input v-model.trim="member.grade" /></label
                ><label>직책 코드<input v-model.trim="member.position" /></label>
                <label
                    >기본등급<select v-model="member.level">
                        <option :value="null">직급·직책에서 자동</option>
                        <option v-for="level in policy.levels" :key="level.id" :value="level.id">레벨 {{ level.id }} · {{ level.name }}</option>
                    </select></label
                >
                <label>조직 코드<input v-model.trim="member.organizationId" /></label><label>사업장<select v-model="member.siteId"><option value="">지정 안 함</option><option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option></select></label><label>시작일<input v-model="member.from" type="date" /></label
                ><label>종료일 (당일 제외)<input v-model="member.to" type="date" /></label><label class="access-check"><input v-model="member.active" type="checkbox" />활성 연결</label
                ><button type="button" :aria-label="`${member.name || index + 1} 사용자 연결 제거`" @click="removeMember(index)">연결 제거</button>
            </div>
        </fieldset>
        <div class="access-section-heading">
            <div>
                <h2>담당 업무 권한</h2>
                <p>기본등급과 별개로 인사·급여·구매 등 업무 역할을 추가합니다.</p>
            </div>
            <button type="button" @click="addRole">업무 역할 추가</button>
        </div>
        <label
            >편집할 업무 역할<select v-model="selectedRole">
                <option value="">역할 선택</option>
                <option v-for="item in policy.roles" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select></label
        >
        <div v-if="role" class="access-person">
            <label>역할 이름<input v-model.trim="role.name" /></label>
            <fieldset>
                <legend>연결 사용자</legend>
                <label v-for="member in linkedMembers" :key="member.id" class="access-check"><input v-model="role.members" type="checkbox" :value="member.id" />{{ member.name }}</label>
            </fieldset>
            <AccessPermissionGrid v-model="role.permissions" :resources="resources" /><button
                type="button"
                @click="
                    policy.roles.splice(policy.roles.indexOf(role), 1);
                    selectedRole = '';
                "
            >
                업무 역할 제거
            </button>
        </div>
        <div class="access-section-heading">
            <div>
                <h2>개별 허용·제한</h2>
                <p>같은 행동·대상 범위에서는 개별 제한이 허용보다 우선합니다.</p>
            </div>
            <button type="button" @click="addOverride">예외 추가</button>
        </div>
        <div v-for="(override, index) in policy.overrides" :key="index" class="access-record">
            <label
                >사용자<select v-model="override.actorId">
                    <option value="">선택</option>
                    <option v-for="member in linkedMembers" :key="member.id" :value="member.id">{{ member.name }}</option>
                </select></label
            >
            <label
                >메뉴<select v-model="override.resource">
                    <option v-for="resource in resources" :key="resource.key" :value="resource.key">{{ resource.label }}</option>
                </select></label
            >
            <label
                >행동<select v-model="override.action">
                    <option v-for="(label, key) in ACTIONS" :key="key" :value="key">{{ label }}</option>
                </select></label
            >
            <label
                >범위<select v-model="override.scope">
                    <option v-for="(label, key) in SCOPES" :key="key" :value="key">{{ label }}</option>
                </select></label
            >
            <label
                >효과<select v-model="override.effect">
                    <option value="deny">제한</option>
                    <option value="allow">허용</option>
                </select></label
            >
            <label>시작일<input v-model="override.from" type="date" /></label><label>종료일 (당일 제외)<input v-model="override.to" type="date" /></label
            ><button type="button" :aria-label="`예외 ${index + 1} 제거`" @click="policy.overrides.splice(index, 1)">제거</button>
        </div>
    </div>
</template>
