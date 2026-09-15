<script setup>
import { computed, ref } from 'vue';
import { ACTIONS, SCOPES } from '@/data/enterpriseAccess';
const props = defineProps({ modelValue: { type: Array, required: true }, resources: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const search = ref('');
const action = ref('read');
const visible = computed(() => props.resources.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(search.value.toLowerCase())));
const actionOptions = Object.entries(ACTIONS).map(([value, label]) => ({ value, label }));
const scopesFor = (resource) => props.modelValue.filter((item) => item.resource === resource && item.action === action.value).map((item) => item.scope);
function changeScope(resource, scope, enabled) {
    const permissions = props.modelValue.filter((item) => item.resource !== resource || item.action !== action.value || item.scope !== scope);
    if (enabled) permissions.push({ resource, action: action.value, scope });
    emit('update:modelValue', permissions);
}
</script>
<template>
    <div>
        <div class="flex flex-col gap-3 mb-3 sm:flex-row sm:items-end">
            <div class="flex flex-col gap-2">
                <label for="permission-search" class="text-sm font-medium">메뉴 검색</label>
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText id="permission-search" v-model="search" type="search" placeholder="메뉴 이름 검색" class="w-full sm:w-72" />
                </IconField>
            </div>
            <div class="flex flex-col gap-2">
                <label id="permission-action-label" for="permission-action" class="text-sm font-medium">편집할 행동</label>
                <Select inputId="permission-action" v-model="action" :options="actionOptions" optionLabel="label" optionValue="value" ariaLabelledby="permission-action-label" class="w-full sm:w-44" />
            </div>
        </div>
        <p class="mb-4 text-sm text-muted-color">행동마다 허용 범위를 지정합니다. 메뉴 접근과 조회는 별개의 권한입니다.</p>

        <div v-for="resource in visible" :key="resource.key" class="flex flex-col gap-3 py-3 border-b border-surface-200 dark:border-surface-700 md:flex-row md:items-center md:justify-between">
            <strong class="min-w-0">{{ resource.label }}</strong>
            <details class="md:w-1/2">
                <summary class="px-3 py-2 border cursor-pointer rounded-border border-surface-300 dark:border-surface-600" :aria-label="resource.label + ' ' + ACTIONS[action] + ' 범위 편집'">
                    {{
                        scopesFor(resource.key)
                            .map((key) => SCOPES[key])
                            .join(', ') || '허용 안 함'
                    }}
                </summary>
                <div class="flex flex-wrap gap-4 px-3 py-3">
                    <div v-for="(label, key) in SCOPES" :key="key" class="flex items-center gap-2">
                        <Checkbox
                            :inputId="resource.key + '-' + key"
                            binary
                            :modelValue="scopesFor(resource.key).includes(key)"
                            :inputProps="{ 'data-scope': key, 'aria-label': resource.label + ' ' + ACTIONS[action] + ' ' + label }"
                            @update:modelValue="changeScope(resource.key, key, $event)"
                        />
                        <label :for="resource.key + '-' + key">{{ label }}</label>
                    </div>
                </div>
            </details>
        </div>

        <p v-if="!visible.length" class="p-8 text-center border border-dashed rounded-border border-surface-300 dark:border-surface-600 text-muted-color">검색 결과가 없습니다.</p>
    </div>
</template>
