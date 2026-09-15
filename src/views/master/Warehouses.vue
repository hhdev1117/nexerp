<script setup>
import { createWarehouseDraft, validateWarehouseDraft, warehousePayload, warehouseTypeLabel, warehouseTypeOptions } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const READ_ONLY_MESSAGE = '창고 등록 및 수정은 관리자 계정에서만 할 수 있습니다. 현재 계정은 조회만 가능합니다.';

const authStore = useAuthStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, sites, warehouses, loading, error, ensureLoaded, createWarehouse, updateWarehouse } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const selectedCompanyId = ref('');
const keyword = ref('');
const saving = ref(false);

const dialog = ref(false);
const mode = ref('create');
const editing = ref(null);
const draft = ref(createWarehouseDraft());
const submitted = ref(false);
const errors = computed(() => validateWarehouseDraft(draft.value));
const dialogTitle = computed(() => (mode.value === 'create' ? '창고 등록' : '창고 정보 수정'));

const label = (row) => (row.code ? `${row.code} · ${row.name}` : row.name);
const companyOptions = computed(() => companies.value.map((company) => ({ value: company.id, label: label(company) })));
const activeCompanyOptions = computed(() => companies.value.filter((company) => company.isActive || company.id === draft.value.companyId).map((company) => ({ value: company.id, label: label(company) })));
const siteOptions = computed(() => sites.value.filter((site) => site.companyId === draft.value.companyId && (site.isActive || site.id === draft.value.siteId)).map((site) => ({ value: site.id, label: label(site) })));
const siteName = (id) => {
    const site = sites.value.find((candidate) => candidate.id === id);
    return site ? label(site) : '—';
};

const visibleWarehouses = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');
    return warehouses.value.filter((warehouse) => {
        if (selectedCompanyId.value && warehouse.companyId !== selectedCompanyId.value) return false;
        if (!query) return true;
        return [warehouse.code, warehouse.name, siteName(warehouse.siteId)].some((value) =>
            String(value || '')
                .toLocaleLowerCase('ko-KR')
                .includes(query)
        );
    });
});

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

// Choosing another company only clears the site when the current one no longer belongs to it,
// so opening the edit dialog keeps the stored site instead of blanking it.
function chooseCompany(companyId) {
    draft.value.companyId = companyId ?? '';
    if (!sites.value.some((site) => site.id === draft.value.siteId && site.companyId === draft.value.companyId)) draft.value.siteId = '';
}

async function focusFirstError() {
    await nextTick();
    const field = ['companyId', 'siteId', 'code', 'name', 'warehouseType'].find((name) => errors.value[name]);
    if (field) document.getElementById(`warehouse-${field}`)?.focus();
}

function openCreate() {
    if (!canManage.value) return;
    mode.value = 'create';
    editing.value = null;
    draft.value = createWarehouseDraft(null, selectedCompanyId.value);
    submitted.value = false;
    dialog.value = true;
}

function openEdit(warehouse) {
    if (!canManage.value) return;
    mode.value = 'edit';
    editing.value = warehouse;
    draft.value = createWarehouseDraft(warehouse);
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
        const payload = warehousePayload(draft.value);
        const saved = mode.value === 'create' ? await createWarehouse(payload) : await updateWarehouse(editing.value.id, payload);
        dialog.value = false;
        selectedCompanyId.value = saved.companyId;
        notify('success', mode.value === 'create' ? '창고 등록 완료' : '창고 수정 완료', `${saved.name} 창고 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '창고 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function toggleActive(warehouse) {
    if (!canManage.value) return;
    const activating = !warehouse.isActive;
    confirm.require({
        group: 'warehouses',
        message: activating ? `${warehouse.name} 창고를 활성화하시겠습니까? 소속 사업장이 비활성이면 활성화할 수 없습니다.` : `${warehouse.name} 창고를 비활성화하시겠습니까?`,
        header: activating ? '창고 활성화' : '창고 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            try {
                await updateWarehouse(warehouse.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${warehouse.name} 창고가 ${activating ? '활성화' : '비활성화'}되었습니다.`);
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
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">창고 관리</h1>
                <div class="mt-1 text-muted-color">사업장에 속한 창고를 관리합니다. 입출고와 재고 이동은 이 창고를 참조합니다. 사업장을 비활성화하면 소속 창고도 함께 비활성화됩니다.</div>
            </div>
            <Button v-if="canManage" label="창고 등록" icon="pi pi-plus" :disabled="!selectedCompanyId" @click="openCreate" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
        <Message v-if="!canManage" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>

        <div class="card">
            <div class="grid grid-cols-12 gap-4 mb-4">
                <div class="col-span-12 sm:col-span-5">
                    <label id="warehouse-company-label" for="warehouse-company" class="block mb-2 font-medium">회사</label>
                    <Select inputId="warehouse-company" v-model="selectedCompanyId" :options="companyOptions" optionLabel="label" optionValue="value" ariaLabelledby="warehouse-company-label" placeholder="회사를 선택하세요" fluid />
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="warehouse-search" class="block mb-2 font-medium">검색</label>
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText id="warehouse-search" v-model="keyword" placeholder="창고코드, 창고명, 사업장 검색" fluid />
                    </IconField>
                </div>
            </div>

            <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="text-sm text-muted-color" aria-live="polite">
                    총 <strong class="text-color">{{ visibleWarehouses.length }}</strong
                    >건
                </div>
                <Button v-if="keyword.trim()" data-testid="warehouse-reset" label="검색 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="keyword = ''" />
            </div>

            <DataTable :value="visibleWarehouses" dataKey="id" :loading="loading" size="small" stripedRows scrollable responsiveLayout="scroll" tableStyle="min-width: 48rem" :tableProps="{ 'aria-label': '창고 목록' }">
                <template #empty>
                    <div class="list-empty">
                        <p class="list-empty-message">{{ keyword.trim() ? '조건에 맞는 창고가 없습니다.' : '등록된 창고가 없습니다.' }}</p>
                        <Button v-if="keyword.trim()" label="검색 초기화" icon="pi pi-filter-slash" severity="secondary" outlined size="small" @click="keyword = ''" />
                        <Button v-else-if="canManage" label="창고 등록" icon="pi pi-plus" size="small" :disabled="!selectedCompanyId" @click="openCreate" />
                    </div>
                </template>
                <Column field="code" header="창고코드" sortable>
                    <template #body="slotProps"
                        ><span class="font-medium">{{ slotProps.data.code }}</span></template
                    >
                </Column>
                <Column field="name" header="창고명" sortable style="min-width: 12rem" />
                <Column header="사업장" style="min-width: 12rem">
                    <template #body="slotProps">{{ siteName(slotProps.data.siteId) }}</template>
                </Column>
                <Column field="warehouseType" header="유형" sortable>
                    <template #body="slotProps">{{ warehouseTypeLabel(slotProps.data.warehouseType) }}</template>
                </Column>
                <Column field="isActive" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="slotProps.data.isActive ? '활성' : '비활성'" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                    <template #body="slotProps">
                        <div class="flex gap-1">
                            <Button data-testid="warehouse-edit" icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.name} 창고 수정`" :title="`${slotProps.data.name} 창고 수정`" @click="openEdit(slotProps.data)" />
                            <Button
                                data-testid="warehouse-toggle"
                                :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                text
                                rounded
                                :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                :aria-label="`${slotProps.data.name} 창고 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                :title="`${slotProps.data.name} 창고 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                @click="toggleActive(slotProps.data)"
                            />
                        </div>
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="dialog" modal :header="dialogTitle" :style="{ width: '34rem' }" :breakpoints="{ '640px': '92vw' }">
            <form id="warehouse-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="save">
                <div class="col-span-12 sm:col-span-6">
                    <label id="warehouse-companyId-label" for="warehouse-companyId" class="block mb-2 font-medium">소속 회사</label>
                    <Select
                        inputId="warehouse-companyId"
                        :modelValue="draft.companyId"
                        :options="activeCompanyOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="warehouse-companyId-label"
                        placeholder="회사를 선택하세요"
                        fluid
                        :invalid="submitted && Boolean(errors.companyId)"
                        @update:modelValue="chooseCompany"
                    />
                    <small v-if="submitted && errors.companyId" class="text-red-700 dark:text-red-400" role="alert">{{ errors.companyId }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="warehouse-siteId-label" for="warehouse-siteId" class="block mb-2 font-medium">사업장</label>
                    <Select
                        inputId="warehouse-siteId"
                        v-model="draft.siteId"
                        :options="siteOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="warehouse-siteId-label"
                        placeholder="사업장을 선택하세요"
                        fluid
                        :invalid="submitted && Boolean(errors.siteId)"
                    />
                    <small v-if="submitted && errors.siteId" class="text-red-700 dark:text-red-400" role="alert">{{ errors.siteId }}</small>
                </div>
                <div class="col-span-12 sm:col-span-5">
                    <label for="warehouse-code" class="block mb-2 font-medium">창고코드</label>
                    <InputText id="warehouse-code" v-model="draft.code" fluid required :disabled="mode === 'edit'" autofocus :invalid="submitted && Boolean(errors.code)" placeholder="예: WH-ICN-RM" class="uppercase" />
                    <small v-if="submitted && errors.code" class="text-red-700 dark:text-red-400" role="alert">{{ errors.code }}</small>
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="warehouse-name" class="block mb-2 font-medium">창고명</label>
                    <InputText id="warehouse-name" v-model="draft.name" fluid required :invalid="submitted && Boolean(errors.name)" placeholder="창고명을 입력하세요" />
                    <small v-if="submitted && errors.name" class="text-red-700 dark:text-red-400" role="alert">{{ errors.name }}</small>
                </div>
                <div class="col-span-12">
                    <label id="warehouse-warehouseType-label" for="warehouse-warehouseType" class="block mb-2 font-medium">유형</label>
                    <Select
                        inputId="warehouse-warehouseType"
                        v-model="draft.warehouseType"
                        :options="warehouseTypeOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="warehouse-warehouseType-label"
                        fluid
                        :invalid="submitted && Boolean(errors.warehouseType)"
                    />
                    <small v-if="submitted && errors.warehouseType" class="text-red-700 dark:text-red-400" role="alert">{{ errors.warehouseType }}</small>
                </div>
                <div v-if="mode === 'edit'" class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="warehouse-isActive" v-model="draft.isActive" />
                    <label for="warehouse-isActive" class="font-medium">활성 창고</label>
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text @click="dialog = false" />
                    <Button type="submit" data-testid="warehouse-save" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <ConfirmDialog group="warehouses" />
    </div>
</template>
