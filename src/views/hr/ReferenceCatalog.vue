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
    <section class="card reference-catalog" aria-label="인사 기준정보">
        <div class="reference-heading">
            <div>
                <h2 class="text-xl font-semibold">인사 기준정보</h2>
                <p class="text-muted-color">직원 배정에 사용할 부서·직급·직책을 관리합니다.</p>
            </div>
            <Button v-if="canManage" data-testid="reference-create" label="기준정보 추가" :disabled="loading || saving" @click="edit(null)" />
        </div>
        <label class="reference-filter" for="reference-filter"
            >종류<select id="reference-filter" v-model="filter">
                <option v-for="(name, key) in kinds" :key="key" :value="key">{{ name }}</option>
            </select></label
        >
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-if="loading" role="status">기준정보를 불러오는 중입니다.</p>
        <ul v-else class="reference-list">
            <li v-for="item in rows" :key="item.id">
                <div>
                    <strong>{{ item.name }}</strong> <span class="text-muted-color">({{ item.code }})</span>
                    <p>
                        {{ item.isActive ? '사용 중' : '사용 중지' }}<span v-if="item.parentCode"> · 상위 부서 {{ item.parentCode }}</span>
                    </p>
                </div>
                <Button v-if="canManage" data-testid="reference-edit" label="수정" :aria-label="`${item.name} 수정`" severity="secondary" :disabled="saving" @click="edit(item)" />
            </li>
        </ul>
        <p v-if="!loading && !rows.length" role="status">등록된 {{ kinds[filter] }}가 없습니다.</p>
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
            <form v-if="draft" data-testid="reference-form" class="reference-form" @submit.prevent="save">
                <label for="reference-kind"
                    >종류<select id="reference-kind" v-model="draft.kind" :disabled="Boolean(draft.id)">
                        <option v-for="(name, key) in kinds" :key="key" :value="key">{{ name }}</option>
                    </select></label
                >
                <label for="reference-code">코드 (등록 후 변경 불가)<input id="reference-code" v-model="draft.code" required maxlength="150" :disabled="Boolean(draft.id)" /></label>
                <label for="reference-name">이름<input id="reference-name" v-model="draft.name" required maxlength="150" /></label>
                <label v-if="draft.kind === 'department'" for="reference-parent"
                    >상위 부서<select id="reference-parent" v-model="draft.parentCode">
                        <option :value="null">없음</option>
                        <option v-if="retainedParent" :value="retainedParent" :disabled="draft.isActive">{{ retainedParent }} (사용 중지)</option>
                        <option v-for="item in parents" :key="item.id" :value="item.code">{{ item.name }} ({{ item.code }})</option>
                    </select></label
                >
                <label for="reference-active" class="reference-check"><input id="reference-active" v-model="draft.isActive" type="checkbox" />사용</label>
                <p class="text-muted-color">사용 중지하면 신규 배정에서 제외됩니다. 현재·예정 직원, 향후 발령 또는 사용 중인 하위 부서가 있으면 중지할 수 없습니다. 기존 이력은 보존됩니다.</p>
                <label for="reference-reason">변경 사유 (필수)<textarea id="reference-reason" v-model="reason" required maxlength="2000" rows="3" /></label>
                <p v-if="validation || error" role="alert">{{ validation || error }}</p>
                <div class="reference-heading"><Button label="닫기" severity="secondary" :disabled="saving" @click="draft = null" /><Button type="submit" :label="saving ? '저장 중…' : '저장'" :disabled="saving" /></div>
            </form>
        </Dialog>
    </section>
</template>
<style scoped>
.reference-heading,
.reference-list li > div {
    min-width: 0;
    overflow-wrap: anywhere;
}
.reference-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
}
.reference-filter {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1.5rem 0;
}
.reference-list {
    list-style: none;
    padding: 0;
}
.reference-list li > div {
    min-width: 0;
    overflow-wrap: anywhere;
}
.reference-list li {
    padding: 1rem 0;
    border-bottom: 1px solid var(--surface-border);
}
p {
    margin: 0.5rem 0;
    line-height: 1.6;
    overflow-wrap: anywhere;
}
.reference-form {
    display: grid;
    gap: 1rem;
}
.reference-form label:not(.reference-check) {
    display: grid;
    gap: 0.5rem;
}
input:not([type='checkbox']),
select,
textarea {
    min-height: 44px;
    padding: 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    background: var(--surface-card);
    color: var(--text-color);
    width: 100%;
    min-width: 0;
}
.reference-filter select {
    width: auto;
}
.reference-check {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    min-height: 44px;
}
[role='alert'] {
    color: var(--p-red-700);
}
</style>
