<script setup>
import { computed, ref } from 'vue';
import { ACTIONS, SCOPES } from '@/data/enterpriseAccess';
const props = defineProps({ modelValue: { type: Array, required: true }, resources: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const search = ref('');
const action = ref('read');
const visible = computed(() => props.resources.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(search.value.toLowerCase())));
const scopesFor = (resource) => props.modelValue.filter((item) => item.resource === resource && item.action === action.value).map((item) => item.scope);
function changeScope(resource, scope, enabled) {
    const permissions = props.modelValue.filter((item) => item.resource !== resource || item.action !== action.value || item.scope !== scope);
    if (enabled) permissions.push({ resource, action: action.value, scope });
    emit('update:modelValue', permissions);
}
</script>
<template>
    <div class="access-grid">
        <div class="access-record">
            <label>메뉴 검색<input v-model="search" type="search" placeholder="메뉴 이름 검색" /></label
            ><label
                >편집할 행동<select v-model="action">
                    <option v-for="(label, key) in ACTIONS" :key="key" :value="key">{{ label }}</option>
                </select></label
            >
        </div>
        <p class="access-help">행동마다 허용 범위를 지정합니다. 메뉴 접근과 조회는 별개의 권한입니다.</p>
        <div v-for="resource in visible" :key="resource.key" class="permission-row">
            <div>
                <strong>{{ resource.label }}</strong>
            </div>
            <details class="scope-picker"><summary :aria-label="`${resource.label} ${ACTIONS[action]} 범위 편집`">{{ scopesFor(resource.key).map((key) => SCOPES[key]).join(', ') || '허용 안 함' }}</summary><label v-for="(label, key) in SCOPES" :key="key" class="access-check"><input type="checkbox" :data-scope="key" :aria-label="`${resource.label} ${ACTIONS[action]} ${label}`" :checked="scopesFor(resource.key).includes(key)" @change="changeScope(resource.key, key, $event.target.checked)" />{{ label }}</label></details>
        </div>
        <p v-if="!visible.length" class="access-empty">검색 결과가 없습니다.</p>
    </div>
</template>
