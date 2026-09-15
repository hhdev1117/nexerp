<script setup>
import { computed, ref } from 'vue';
import { useHrReferenceStore } from '@/stores/hrReference';
const store = useHrReferenceStore();
const { catalog, canManage, loading, saving, error } = store;
const kinds = { department: '부서', grade: '직급', position: '직책' };
const filter = ref('department');
const draft = ref(null);
const reason = ref('');
const validation = ref('');
const rows = computed(() => catalog.value.filter((x) => x.kind === filter.value));
const retainedParent = computed(() => (draft.value?.parentCode && !parents.value.some((x) => x.code === draft.value.parentCode) ? draft.value.parentCode : null));
const parents = computed(() => catalog.value.filter((x) => x.kind === 'department' && x.isActive && x.code !== draft.value?.code));
const kindOptions = Object.entries(kinds).map(([value, label]) => ({ value, label }));
const parentOptions = computed(() => {
    const list = [{ value: null, label: '없음' }];
    if (retainedParent.value) list.push({ value: retainedParent.value, label: retainedParent.value + ' (사용 중지)', disabled: Boolean(draft.value?.isActive) });
    return [...list, ...parents.value.map((item) => ({ value: item.code, label: item.name + ' (' + item.code + ')' }))];
});
function edit(item) {
    draft.value = item ? { ...item } : { id: null, kind: filter.value, code: '', name: '', parentCode: null, isActive: true, revision: 0 };
    reason.value = '';
    validation.value = '';
}
async function save() {
    if (saving.value || !canManage.value) return;
    if (!reason.value.trim() || !draft.value.name.trim() || !(draft.value.id ? draft.value.code.length : draft.value.code.trim().length)) {
        validation.value = '코드, 이름과 변경 사유를 입력해 주세요.';
        return;
    }
    if (draft.value.kind === 'department' && draft.value.isActive && retainedParent.value) {
        validation.value = '사용 중인 상위 부서를 선택해 주세요.';
        return;
    }
    const { revision, id, kind, code, name, parentCode, isActive } = draft.value;
    const doc = { id, kind, code: id ? code : code.trim(), name: name.trim(), parentCode: kind === 'department' ? parentCode || null : null, isActive };
    if (await store.save(doc, revision, reason.value.trim())) draft.value = null;
}
</script>
<template>
    <section class="card" aria-label="인사 기준정보">
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">인사 기준정보</h2>
                <div class="mt-1 text-muted-color">직원 배정에 사용할 부서·직급·직책을 관리합니다.</div>
            </div>
            <Button v-if="canManage" data-testid="reference-create" label="기준정보 추가" icon="pi pi-plus" :disabled="loading || saving" @click="edit(null)" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>

        <div class="flex flex-col gap-2 mb-6 sm:flex-row sm:items-center sm:gap-3">
            <label id="reference-filter-label" for="reference-filter" class="text-sm font-medium">종류</label>
            <Select inputId="reference-filter" v-model="filter" :options="kindOptions" optionLabel="label" optionValue="value" ariaLabelledby="reference-filter-label" class="w-full sm:w-44" />
        </div>

        <DataTable :value="rows" dataKey="id" :loading="loading" size="small" stripedRows responsiveLayout="scroll" tableStyle="min-width: 36rem" :tableProps="{ 'aria-label': '인사 기준정보 목록' }">
            <template #empty>
                <div class="list-empty">
                    <p class="list-empty-message">등록된 {{ kinds[filter] }}가 없습니다.</p>
                    <Button v-if="canManage" label="기준정보 추가" icon="pi pi-plus" size="small" @click="edit(null)" />
                </div>
            </template>
            <Column header="이름" style="min-width: 12rem">
                <template #body="slotProps">
                    <span class="font-medium">{{ slotProps.data.name }}</span>
                    <span class="ml-2 text-muted-color">({{ slotProps.data.code }})</span>
                </template>
            </Column>
            <Column header="상태">
                <template #body="slotProps">
                    <Tag :value="slotProps.data.isActive ? '사용 중' : '사용 중지'" :severity="slotProps.data.isActive ? 'success' : 'secondary'" />
                </template>
            </Column>
            <Column header="상위 부서">
                <template #body="slotProps">{{ slotProps.data.parentCode || '—' }}</template>
            </Column>
            <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                <template #body="slotProps">
                    <Button data-testid="reference-edit" label="수정" icon="pi pi-pencil" size="small" severity="secondary" outlined :aria-label="slotProps.data.name + ' 수정'" :disabled="saving" @click="edit(slotProps.data)" />
                </template>
            </Column>
        </DataTable>

        <Dialog
            :visible="Boolean(draft)"
            modal
            :header="draft?.id ? '기준정보 수정' : '기준정보 추가'"
            :style="{ width: '36rem', maxWidth: '95vw' }"
            :closable="!saving"
            @update:visible="
                (value) => {
                    if (!value) draft = null;
                }
            "
        >
            <form v-if="draft" data-testid="reference-form" class="flex flex-col gap-5" novalidate :aria-busy="saving" @submit.prevent="save">
                <div class="flex flex-col gap-2">
                    <label id="reference-kind-label" for="reference-kind" class="font-medium">종류</label>
                    <Select inputId="reference-kind" v-model="draft.kind" :options="kindOptions" optionLabel="label" optionValue="value" ariaLabelledby="reference-kind-label" :disabled="Boolean(draft.id)" fluid />
                </div>
                <div class="flex flex-col gap-2">
                    <label for="reference-code" class="font-medium">코드 (등록 후 변경 불가)</label>
                    <InputText id="reference-code" v-model="draft.code" required maxlength="150" :disabled="Boolean(draft.id)" fluid />
                </div>
                <div class="flex flex-col gap-2">
                    <label for="reference-name" class="font-medium">이름</label>
                    <InputText id="reference-name" v-model="draft.name" required maxlength="150" fluid />
                </div>
                <div v-if="draft.kind === 'department'" class="flex flex-col gap-2">
                    <label id="reference-parent-label" for="reference-parent" class="font-medium">상위 부서</label>
                    <Select inputId="reference-parent" v-model="draft.parentCode" :options="parentOptions" optionLabel="label" optionValue="value" :optionDisabled="(option) => option.disabled" ariaLabelledby="reference-parent-label" fluid />
                </div>
                <div class="flex items-center gap-3">
                    <Checkbox inputId="reference-active" v-model="draft.isActive" binary />
                    <label for="reference-active">사용</label>
                </div>
                <p class="m-0 text-muted-color">사용 중지하면 신규 배정에서 제외됩니다. 현재·예정 직원, 향후 발령 또는 사용 중인 하위 부서가 있으면 중지할 수 없습니다. 기존 이력은 보존됩니다.</p>
                <div class="flex flex-col gap-2">
                    <label for="reference-reason" class="font-medium">변경 사유 (필수)</label>
                    <Textarea id="reference-reason" v-model="reason" required maxlength="2000" rows="3" fluid />
                </div>
                <Message v-if="validation || error" severity="error" :closable="false" role="alert">{{ validation || error }}</Message>
                <div class="flex justify-end gap-2 pt-1">
                    <Button type="button" label="닫기" severity="secondary" text :disabled="saving" @click="draft = null" />
                    <Button type="submit" :label="saving ? '저장 중…' : '저장'" icon="pi pi-check" :disabled="saving" />
                </div>
            </form>
        </Dialog>
    </section>
</template>
