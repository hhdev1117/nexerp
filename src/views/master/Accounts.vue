<script setup>
import { accountOutline, accountPayload, accountTypeLabel, accountTypeOptions, createAccountDraft, validateAccountDraft } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const READ_ONLY_MESSAGE = '계정과목 등록 및 수정은 관리자 계정에서만 할 수 있습니다. 현재 계정은 조회만 가능합니다.';

const authStore = useAuthStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, accounts, loading, error, ensureLoaded, createAccount, updateAccount } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const selectedCompanyId = ref('');
const selectedType = ref(null);
const saving = ref(false);

const dialog = ref(false);
const mode = ref('create');
const editing = ref(null);
const draft = ref(createAccountDraft());
const submitted = ref(false);
const errors = computed(() => validateAccountDraft(draft.value));
const dialogTitle = computed(() => (mode.value === 'create' ? '계정과목 등록' : '계정과목 수정'));

const companyOptions = computed(() => companies.value.map((company) => ({ value: company.id, label: company.code ? `${company.code} · ${company.name}` : company.name })));
const companyAccounts = computed(() => accounts.value.filter((account) => account.companyId === selectedCompanyId.value));

// The outline keeps parents immediately above their children; the type filter narrows it afterwards
// so indentation still reflects the real chart.
const outline = computed(() => accountOutline(companyAccounts.value).filter((account) => !selectedType.value || account.accountType === selectedType.value));

// Only summary accounts of the same company and type may be a parent, and never the row itself.
const parentOptions = computed(() => {
    const candidates = accountOutline(accounts.value.filter((account) => account.companyId === draft.value.companyId && account.accountType === draft.value.accountType && !account.isPostable && account.id !== editing.value?.id));
    return [{ value: null, label: '없음 (최상위)' }, ...candidates.map((account) => ({ value: account.id, label: `${'  '.repeat(account.depth)}${account.code} · ${account.name}` }))];
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

// Changing the type or company invalidates a parent chosen under the previous one.
function chooseScope(key, value) {
    draft.value[key] = value ?? (key === 'companyId' ? '' : draft.value[key]);
    const stillValid = accounts.value.some((account) => account.id === draft.value.parentId && account.companyId === draft.value.companyId && account.accountType === draft.value.accountType && !account.isPostable);
    if (!stillValid) draft.value.parentId = null;
}

async function focusFirstError() {
    await nextTick();
    const field = ['companyId', 'code', 'name', 'accountType'].find((name) => errors.value[name]);
    if (field) document.getElementById(`account-${field}`)?.focus();
}

function openCreate() {
    if (!canManage.value) return;
    mode.value = 'create';
    editing.value = null;
    draft.value = createAccountDraft(null, selectedCompanyId.value);
    submitted.value = false;
    dialog.value = true;
}

function openEdit(account) {
    if (!canManage.value) return;
    mode.value = 'edit';
    editing.value = account;
    draft.value = createAccountDraft(account);
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
        const payload = accountPayload(draft.value);
        const saved = mode.value === 'create' ? await createAccount(payload) : await updateAccount(editing.value.id, payload);
        dialog.value = false;
        selectedCompanyId.value = saved.companyId;
        notify('success', mode.value === 'create' ? '계정과목 등록 완료' : '계정과목 수정 완료', `${saved.code} ${saved.name} 계정이 저장되었습니다.`);
    } catch (cause) {
        notify('error', '계정과목 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function toggleActive(account) {
    if (!canManage.value) return;
    const activating = !account.isActive;
    confirm.require({
        group: 'accounts',
        message: activating ? `${account.name} 계정을 활성화하시겠습니까? 상위 계정이 비활성이면 활성화할 수 없습니다.` : `${account.name} 계정을 비활성화하시겠습니까? 하위 계정도 함께 비활성화됩니다.`,
        header: activating ? '계정 활성화' : '계정 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            try {
                await updateAccount(account.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${account.name} 계정이 ${activating ? '활성화' : '비활성화'}되었습니다.`);
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
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">계정과목</h1>
                <div class="mt-1 text-muted-color">회계 계정 체계를 관리합니다. 상위 계정은 하위를 묶기만 하고, 전표는 말단 계정에만 입력합니다. 상위를 비활성화하면 하위도 함께 비활성화됩니다.</div>
            </div>
            <Button v-if="canManage" label="계정 등록" icon="pi pi-plus" :disabled="!selectedCompanyId" @click="openCreate" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
        <Message v-if="!canManage" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>

        <div class="card">
            <div class="grid grid-cols-12 gap-4 mb-4">
                <div class="col-span-12 sm:col-span-6">
                    <label id="account-company-label" for="account-company" class="block mb-2 font-medium">회사</label>
                    <Select inputId="account-company" v-model="selectedCompanyId" :options="companyOptions" optionLabel="label" optionValue="value" ariaLabelledby="account-company-label" placeholder="회사를 선택하세요" fluid />
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="account-filter-type-label" for="account-filter-type" class="block mb-2 font-medium">계정 유형</label>
                    <Select inputId="account-filter-type" v-model="selectedType" :options="accountTypeOptions" optionLabel="label" optionValue="value" ariaLabelledby="account-filter-type-label" placeholder="전체 유형" showClear fluid />
                </div>
            </div>

            <div class="text-sm text-muted-color mb-4" aria-live="polite">
                총 <strong class="text-color">{{ outline.length }}</strong
                >건
            </div>

            <DataTable :value="outline" dataKey="id" :loading="loading" size="small" stripedRows scrollable responsiveLayout="scroll" tableStyle="min-width: 48rem" :tableProps="{ 'aria-label': '계정과목 목록' }">
                <template #empty>
                    <div class="list-empty">
                        <p class="list-empty-message">등록된 계정과목이 없습니다.</p>
                        <Button v-if="canManage" label="계정 등록" icon="pi pi-plus" size="small" :disabled="!selectedCompanyId" @click="openCreate" />
                    </div>
                </template>
                <Column header="코드" sortable field="code" style="min-width: 16rem">
                    <template #body="slotProps">
                        <span :style="{ paddingInlineStart: `${slotProps.data.depth * 1.25}rem` }" class="font-medium">{{ slotProps.data.code }}</span>
                    </template>
                </Column>
                <Column field="name" header="계정과목명" sortable style="min-width: 12rem" />
                <Column field="accountType" header="유형" sortable>
                    <template #body="slotProps">{{ accountTypeLabel(slotProps.data.accountType) }}</template>
                </Column>
                <Column field="isPostable" header="전표 입력" sortable>
                    <template #body="slotProps"><Tag :value="slotProps.data.isPostable ? '가능' : '집계 전용'" :severity="slotProps.data.isPostable ? 'info' : 'secondary'" /></template>
                </Column>
                <Column field="isActive" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="slotProps.data.isActive ? '활성' : '비활성'" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                    <template #body="slotProps">
                        <div class="flex gap-1">
                            <Button data-testid="account-edit" icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.name} 계정 수정`" :title="`${slotProps.data.name} 계정 수정`" @click="openEdit(slotProps.data)" />
                            <Button
                                data-testid="account-toggle"
                                :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                text
                                rounded
                                :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                :aria-label="`${slotProps.data.name} 계정 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                :title="`${slotProps.data.name} 계정 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                @click="toggleActive(slotProps.data)"
                            />
                        </div>
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="dialog" modal :header="dialogTitle" :style="{ width: '34rem' }" :breakpoints="{ '640px': '92vw' }">
            <form id="account-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="save">
                <div class="col-span-12 sm:col-span-6">
                    <label id="account-companyId-label" for="account-companyId" class="block mb-2 font-medium">소속 회사</label>
                    <Select
                        inputId="account-companyId"
                        :modelValue="draft.companyId"
                        :options="companyOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="account-companyId-label"
                        placeholder="회사를 선택하세요"
                        fluid
                        :invalid="submitted && Boolean(errors.companyId)"
                        @update:modelValue="chooseScope('companyId', $event)"
                    />
                    <small v-if="submitted && errors.companyId" class="text-red-700 dark:text-red-400" role="alert">{{ errors.companyId }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label id="account-accountType-label" for="account-accountType" class="block mb-2 font-medium">계정 유형</label>
                    <Select
                        inputId="account-accountType"
                        :modelValue="draft.accountType"
                        :options="accountTypeOptions"
                        optionLabel="label"
                        optionValue="value"
                        ariaLabelledby="account-accountType-label"
                        fluid
                        :invalid="submitted && Boolean(errors.accountType)"
                        @update:modelValue="chooseScope('accountType', $event)"
                    />
                    <small v-if="submitted && errors.accountType" class="text-red-700 dark:text-red-400" role="alert">{{ errors.accountType }}</small>
                </div>
                <div class="col-span-12 sm:col-span-4">
                    <label for="account-code" class="block mb-2 font-medium">계정 코드</label>
                    <InputText id="account-code" v-model="draft.code" fluid required inputmode="numeric" :disabled="mode === 'edit'" autofocus :invalid="submitted && Boolean(errors.code)" placeholder="예: 111" />
                    <small v-if="submitted && errors.code" class="text-red-700 dark:text-red-400" role="alert">{{ errors.code }}</small>
                </div>
                <div class="col-span-12 sm:col-span-8">
                    <label for="account-name" class="block mb-2 font-medium">계정과목명</label>
                    <InputText id="account-name" v-model="draft.name" fluid required :invalid="submitted && Boolean(errors.name)" placeholder="계정과목명을 입력하세요" />
                    <small v-if="submitted && errors.name" class="text-red-700 dark:text-red-400" role="alert">{{ errors.name }}</small>
                </div>
                <div class="col-span-12">
                    <label id="account-parentId-label" for="account-parentId" class="block mb-2 font-medium">상위 계정</label>
                    <Select inputId="account-parentId" v-model="draft.parentId" :options="parentOptions" optionLabel="label" optionValue="value" ariaLabelledby="account-parentId-label" fluid />
                    <small class="text-muted-color">같은 회사, 같은 유형의 집계 전용 계정만 상위로 지정할 수 있습니다.</small>
                </div>
                <div class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="account-isPostable" v-model="draft.isPostable" />
                    <label for="account-isPostable" class="font-medium">전표 입력 가능 (말단 계정)</label>
                </div>
                <div v-if="mode === 'edit'" class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="account-isActive" v-model="draft.isActive" />
                    <label for="account-isActive" class="font-medium">활성 계정</label>
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text @click="dialog = false" />
                    <Button type="submit" data-testid="account-save" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <ConfirmDialog group="accounts" />
    </div>
</template>
