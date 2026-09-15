<script setup>
import { formatWon } from '@/data/erp';
import { createItemDraft, itemPayload, itemTypeLabel, itemTypeOptions, itemUnitOptions, validateItemDraft } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const READ_ONLY_MESSAGE = '품목 등록 및 수정은 관리자 계정에서만 할 수 있습니다. 현재 계정은 조회만 가능합니다.';

const authStore = useAuthStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, items, loading, error, ensureLoaded, createItem, updateItem } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const selectedCompanyId = ref('');
const keyword = ref('');
const selectedType = ref(null);
const saving = ref(false);

const dialog = ref(false);
const mode = ref('create');
const editing = ref(null);
const draft = ref(createItemDraft());
const submitted = ref(false);
const errors = computed(() => validateItemDraft(draft.value));
const dialogTitle = computed(() => (mode.value === 'create' ? '품목 등록' : '품목 정보 수정'));

const companyOptions = computed(() => companies.value.map((company) => ({ value: company.id, label: company.code ? `${company.code} · ${company.name}` : company.name })));
const activeCompanyOptions = computed(() => companies.value.filter((company) => company.isActive || company.id === draft.value.companyId).map((company) => ({ value: company.id, label: company.code ? `${company.code} · ${company.name}` : company.name })));

const visibleItems = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');
    return items.value.filter((item) => {
        if (selectedCompanyId.value && item.companyId !== selectedCompanyId.value) return false;
        if (selectedType.value && item.itemType !== selectedType.value) return false;
        if (!query) return true;
        return [item.code, item.name, item.unit].some((value) =>
            String(value || '')
                .toLocaleLowerCase('ko-KR')
                .includes(query)
        );
    });
});

const hasActiveFilters = computed(() => Boolean(keyword.value.trim() || selectedType.value));

onMounted(() => ensureLoaded());

watch(
    companies,
    (rows) => {
        if (!selectedCompanyId.value || !rows.some((company) => company.id === selectedCompanyId.value)) selectedCompanyId.value = rows[0]?.id ?? '';
    },
    { immediate: true }
);

const notify = (severity, summary, detail) => toast.add({ severity, summary, detail, life: severity === 'success' ? 3000 : 3200 });
const failureDetail = (cause) => MASTER_ERROR_MESSAGES[cause?.code] || MASTER_ERROR_MESSAGES.master_save_failed;

function resetFilters() {
    keyword.value = '';
    selectedType.value = null;
}

async function focusFirstError() {
    await nextTick();
    const field = ['companyId', 'code', 'name', 'itemType', 'unit', 'safetyStock', 'standardPrice'].find((name) => errors.value[name]);
    if (field) document.getElementById(`item-${field}`)?.focus();
}

function openCreate() {
    if (!canManage.value) return;
    mode.value = 'create';
    editing.value = null;
    draft.value = createItemDraft(null, selectedCompanyId.value);
    submitted.value = false;
    dialog.value = true;
}

function openEdit(item) {
    if (!canManage.value) return;
    mode.value = 'edit';
    editing.value = item;
    draft.value = createItemDraft(item);
    submitted.value = false;
    dialog.value = true;
}

async function save() {
    if (!canManage.value) return;
    submitted.value = true;
    if (Object.keys(errors.value).length) {
        await focusFirstError();
        return;
    }

    saving.value = true;
    try {
        const payload = itemPayload(draft.value);
        const saved = mode.value === 'create' ? await createItem(payload) : await updateItem(editing.value.id, payload);
        dialog.value = false;
        selectedCompanyId.value = saved.companyId;
        notify('success', mode.value === 'create' ? '품목 등록 완료' : '품목 수정 완료', `${saved.name} 품목 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '품목 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function toggleActive(item) {
    if (!canManage.value) return;
    const activating = !item.isActive;
    confirm.require({
        group: 'items',
        message: `${item.name} 품목을 ${activating ? '활성화' : '비활성화'}하시겠습니까?`,
        header: activating ? '품목 활성화' : '품목 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            try {
                await updateItem(item.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${item.name} 품목이 ${activating ? '활성화' : '비활성화'}되었습니다.`);
            } catch (cause) {
                notify('error', '상태 변경 실패', failureDetail(cause));
            }
        }
    });
}
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">품목 기준정보</h1>
                <div class="mt-1 text-muted-color">전사 품목 원장입니다. 수주, 발주, 재고, 생산 화면은 이 원장을 조회하고 선택합니다. 삭제 대신 비활성화로 이력을 보존합니다.</div>
            </div>
            <Button v-if="canManage" label="품목 등록" icon="pi pi-plus" :disabled="!selectedCompanyId" @click="openCreate" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
        <Message v-if="!canManage" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>

        <div class="card">
            <div class="grid grid-cols-12 gap-4 mb-4">
                <div class="col-span-12 sm:col-span-5 xl:col-span-4">
                    <label id="item-company-label" for="item-company" class="block mb-2 font-medium">회사</label>
                    <Select inputId="item-company" v-model="selectedCompanyId" :options="companyOptions" optionLabel="label" optionValue="value" ariaLabelledby="item-company-label" placeholder="회사를 선택하세요" fluid />
                </div>
                <div class="col-span-12 sm:col-span-4 xl:col-span-3">
                    <label id="item-filter-type-label" for="item-filter-type" class="block mb-2 font-medium">유형</label>
                    <Select inputId="item-filter-type" v-model="selectedType" :options="itemTypeOptions" optionLabel="label" optionValue="value" ariaLabelledby="item-filter-type-label" placeholder="전체 유형" showClear fluid />
                </div>
                <div class="col-span-12 sm:col-span-3 xl:col-span-5">
                    <label for="item-search" class="block mb-2 font-medium">검색</label>
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText id="item-search" v-model="keyword" placeholder="품목코드, 품목명, 단위 검색" fluid />
                    </IconField>
                </div>
            </div>

            <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="text-sm text-muted-color" aria-live="polite">
                    총 <strong class="text-color">{{ visibleItems.length }}</strong
                    >건
                </div>
                <Button v-if="hasActiveFilters" data-testid="item-reset" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilters" />
            </div>

            <DataTable :value="visibleItems" dataKey="id" :loading="loading" size="small" stripedRows scrollable responsiveLayout="scroll" tableStyle="min-width: 56rem" :tableProps="{ 'aria-label': '품목 목록' }" paginator :rows="20" :rowsPerPageOptions="[20, 50, 100]">
                <template #empty>
                    <div class="list-empty">
                        <p class="list-empty-message">{{ hasActiveFilters ? '조건에 맞는 품목이 없습니다.' : '등록된 품목이 없습니다.' }}</p>
                        <Button v-if="hasActiveFilters" label="필터 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="resetFilters" />
                        <Button v-else-if="canManage" label="품목 등록" icon="pi pi-plus" size="small" :disabled="!selectedCompanyId" @click="openCreate" />
                    </div>
                </template>
                <Column field="code" header="품목코드" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium">{{ slotProps.data.code }}</span></template
                    >
                </Column>
                <Column field="name" header="품목명" sortable style="min-width: 14rem" />
                <Column field="itemType" header="유형" sortable>
                    <template #body="slotProps">{{ itemTypeLabel(slotProps.data.itemType) }}</template>
                </Column>
                <Column field="unit" header="단위" sortable />
                <Column field="safetyStock" header="안전재고" sortable headerClass="num-col" bodyClass="num-col">
                    <template #body="slotProps">{{ slotProps.data.safetyStock.toLocaleString('ko-KR') }}</template>
                </Column>
                <Column field="standardPrice" header="표준단가" sortable headerClass="num-col" bodyClass="num-col">
                    <template #body="slotProps">{{ formatWon(slotProps.data.standardPrice) }}</template>
                </Column>
                <Column field="isActive" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="slotProps.data.isActive ? '활성' : '비활성'" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                    <template #body="slotProps">
                        <div class="flex gap-1">
                            <Button data-testid="item-edit" icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.name} 품목 수정`" :title="`${slotProps.data.name} 품목 수정`" @click="openEdit(slotProps.data)" />
                            <Button
                                data-testid="item-toggle"
                                :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                text
                                rounded
                                :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                :aria-label="`${slotProps.data.name} 품목 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                :title="`${slotProps.data.name} 품목 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                @click="toggleActive(slotProps.data)"
                            />
                        </div>
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="dialog" modal :header="dialogTitle" :style="{ width: '36rem' }" :breakpoints="{ '640px': '92vw' }">
            <form id="item-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="save">
                <div class="col-span-12">
                    <label id="item-companyId-label" for="item-companyId" class="block mb-2 font-medium">소속 회사</label>
                    <Select
                        inputId="item-companyId"
                        v-model="draft.companyId"
                        :options="activeCompanyOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="item-companyId-label"
                        placeholder="회사를 선택하세요"
                        fluid
                        :invalid="submitted && Boolean(errors.companyId)"
                    />
                    <small v-if="submitted && errors.companyId" class="text-red-700 dark:text-red-400" role="alert">{{ errors.companyId }}</small>
                </div>
                <div class="col-span-12 sm:col-span-5">
                    <label for="item-code" class="block mb-2 font-medium">품목코드</label>
                    <InputText id="item-code" v-model="draft.code" fluid required :disabled="mode === 'edit'" autofocus :invalid="submitted && Boolean(errors.code)" placeholder="예: RM-AL-001" class="uppercase" />
                    <small v-if="submitted && errors.code" class="text-red-700 dark:text-red-400" role="alert">{{ errors.code }}</small>
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="item-name" class="block mb-2 font-medium">품목명</label>
                    <InputText id="item-name" v-model="draft.name" fluid required :invalid="submitted && Boolean(errors.name)" placeholder="품목명을 입력하세요" />
                    <small v-if="submitted && errors.name" class="text-red-700 dark:text-red-400" role="alert">{{ errors.name }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="item-itemType-label" for="item-itemType" class="block mb-2 font-medium">유형</label>
                    <Select inputId="item-itemType" v-model="draft.itemType" :options="itemTypeOptions" optionLabel="label" optionValue="value" ariaLabelledby="item-itemType-label" fluid :invalid="submitted && Boolean(errors.itemType)" />
                    <small v-if="submitted && errors.itemType" class="text-red-700 dark:text-red-400" role="alert">{{ errors.itemType }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="item-unit-label" for="item-unit" class="block mb-2 font-medium">단위</label>
                    <Select inputId="item-unit" v-model="draft.unit" :options="itemUnitOptions" optionLabel="label" optionValue="value" ariaLabelledby="item-unit-label" editable fluid :invalid="submitted && Boolean(errors.unit)" />
                    <small v-if="submitted && errors.unit" class="text-red-700 dark:text-red-400" role="alert">{{ errors.unit }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="item-safetyStock" class="block mb-2 font-medium">안전재고</label>
                    <InputText id="item-safetyStock" v-model="draft.safetyStock" fluid inputmode="decimal" :invalid="submitted && Boolean(errors.safetyStock)" placeholder="0" />
                    <small v-if="submitted && errors.safetyStock" class="text-red-700 dark:text-red-400" role="alert">{{ errors.safetyStock }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="item-standardPrice" class="block mb-2 font-medium">표준단가 (원)</label>
                    <InputText id="item-standardPrice" v-model="draft.standardPrice" fluid inputmode="numeric" :invalid="submitted && Boolean(errors.standardPrice)" placeholder="0" />
                    <small v-if="submitted && errors.standardPrice" class="text-red-700 dark:text-red-400" role="alert">{{ errors.standardPrice }}</small>
                </div>
                <div v-if="mode === 'edit'" class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="item-isActive" v-model="draft.isActive" />
                    <label for="item-isActive" class="font-medium">활성 품목</label>
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text @click="dialog = false" />
                    <Button type="submit" data-testid="item-save" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <ConfirmDialog group="items" />
    </div>
</template>
