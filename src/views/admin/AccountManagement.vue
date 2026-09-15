<script setup>
import { useAdminApi } from '@/services/adminApi';
import { useAuthStore } from '@/stores/auth';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onMounted, ref } from 'vue';
import { accountCreatePayload, accountRoleOptions, accountUpdatePayload, createAccountDraft, createEditAccountDraft, validateAccountDraft, validatePasswordResetDraft } from './adminModels';

const adminApi = useAdminApi();
const authStore = useAuthStore();
const confirm = useConfirm();
const toast = useToast();

const accounts = ref([]);
const loading = ref(true);
const saving = ref(false);
const loadError = ref(false);
const keyword = ref('');
const selectedRole = ref(null);
const selectedStatus = ref(null);
const accountDialog = ref(false);
const dialogMode = ref('create');
const editingAccount = ref(null);
const submitted = ref(false);
const draft = ref(createAccountDraft());
const passwordResetDialog = ref(false);
const passwordResetAccount = ref(null);
const passwordResetDraft = ref({ temporaryPassword: '', confirmation: '' });
const passwordResetSubmitted = ref(false);
const resettingPassword = ref(false);
const resettingMfa = ref(false);
const actionAccountId = ref(null);

const roleLabels = Object.freeze({ admin: '관리자', approver: '결재자', user: '사용자' });
const roleSeverities = Object.freeze({ admin: 'danger', approver: 'warn', user: 'secondary' });
const roleFilterOptions = accountRoleOptions.map((role) => role);
const createRoleOptions = accountRoleOptions.filter((role) => role.value !== 'admin');
const statusOptions = [
    { label: '활성', value: true },
    { label: '비활성', value: false }
];

const formErrors = computed(() => validateAccountDraft(draft.value, dialogMode.value));
const passwordResetErrors = computed(() => validatePasswordResetDraft(passwordResetDraft.value));
const isEditingCurrentAccount = computed(() => dialogMode.value === 'edit' && isCurrentAccount(editingAccount.value));
const dialogTitle = computed(() => (dialogMode.value === 'create' ? '새 계정 등록' : '계정 정보 수정'));
const filteredAccounts = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');
    return accounts.value.filter((account) => {
        const matchesKeyword = !query || [account.email, account.displayName, account.department].some((value) => value?.toLocaleLowerCase('ko-KR').includes(query));
        const matchesRole = !selectedRole.value || account.role === selectedRole.value;
        const matchesStatus = selectedStatus.value === null || account.isActive === selectedStatus.value;
        return matchesKeyword && matchesRole && matchesStatus;
    });
});

const failureDetail = (error, fallback) => {
    const messages = {
        email_exists: '이미 사용 중인 이메일입니다.',
        gmail_required: 'Gmail 주소만 사용할 수 있습니다.',
        mfa_required: '다중 인증을 완료한 후 다시 시도해 주세요.',
        self_mfa_reset_forbidden: '현재 관리자 계정의 인증 앱은 이 방식으로 초기화할 수 없습니다.',
        self_demotion_forbidden: '현재 관리자 계정의 권한은 변경할 수 없습니다.',
        self_deactivation_forbidden: '현재 관리자 계정은 비활성화할 수 없습니다.',
        invalid_session: '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.',
        admin_required: '관리자 권한이 필요합니다.'
    };
    return messages[error?.code] || fallback;
};

const isCurrentAccount = (account) => typeof account?.id === 'string' && account.id.toLowerCase() === authStore.user.value?.id?.toLowerCase();
const passwordResetActionLabel = (account) => `${account.displayName} 임시 비밀번호 재설정`;
const mfaResetActionLabel = (account) => `${account.displayName} 인증 앱 초기화`;
const statusActionLabel = (account) => `${account.displayName} ${account.isActive ? 'ERP 계정 잠금' : '계정 활성화'}`;

async function loadAccounts() {
    loading.value = true;
    loadError.value = false;
    try {
        accounts.value = await adminApi.listAccounts();
    } catch {
        accounts.value = [];
        loadError.value = true;
    } finally {
        loading.value = false;
    }
}

function openCreateDialog() {
    dialogMode.value = 'create';
    editingAccount.value = null;
    draft.value = createAccountDraft();
    submitted.value = false;
    accountDialog.value = true;
}

function openEditDialog(account) {
    dialogMode.value = 'edit';
    editingAccount.value = account;
    draft.value = createEditAccountDraft(account);
    submitted.value = false;
    accountDialog.value = true;
}

function clearSensitiveDraft() {
    if ('temporaryPassword' in draft.value) draft.value.temporaryPassword = '';
}

function closeDialog() {
    clearSensitiveDraft();
    accountDialog.value = false;
    editingAccount.value = null;
    submitted.value = false;
    draft.value = createAccountDraft();
}

function clearPasswordResetDraft() {
    passwordResetDraft.value = { temporaryPassword: '', confirmation: '' };
    passwordResetSubmitted.value = false;
}

function openPasswordResetDialog(account) {
    if (isCurrentAccount(account)) return;
    passwordResetAccount.value = account;
    clearPasswordResetDraft();
    passwordResetDialog.value = true;
}

function closePasswordResetDialog() {
    if (resettingPassword.value) return;
    clearPasswordResetDraft();
    passwordResetDialog.value = false;
    passwordResetAccount.value = null;
}

async function focusFirstPasswordResetError() {
    await nextTick();
    const firstError = ['temporaryPassword', 'confirmation'].find((field) => passwordResetErrors.value[field]);
    document.getElementById(`reset-${firstError}`)?.focus();
}

async function focusPasswordResetField() {
    await nextTick();
    document.getElementById('reset-temporaryPassword')?.focus();
}

async function resetAccountPassword() {
    if (resettingPassword.value || !passwordResetAccount.value || isCurrentAccount(passwordResetAccount.value)) return;
    passwordResetSubmitted.value = true;
    if (Object.keys(passwordResetErrors.value).length) {
        await focusFirstPasswordResetError();
        return;
    }

    resettingPassword.value = true;
    try {
        await adminApi.resetAccountPassword(passwordResetAccount.value.id, passwordResetDraft.value.temporaryPassword);
        toast.add({ severity: 'success', summary: '비밀번호 재설정 완료', detail: `${passwordResetAccount.value.displayName} 계정의 임시 비밀번호가 변경되었습니다.`, life: 3000 });
        passwordResetDialog.value = false;
    } catch (error) {
        toast.add({ severity: 'error', summary: '비밀번호 재설정 실패', detail: failureDetail(error, '임시 비밀번호를 재설정하지 못했습니다. 잠시 후 다시 시도해 주세요.'), life: 3600 });
    } finally {
        clearPasswordResetDraft();
        resettingPassword.value = false;
    }
}

async function persistAccountMfaReset(account) {
    if (resettingMfa.value || !account || isCurrentAccount(account)) return;
    resettingMfa.value = true;
    try {
        await adminApi.resetAccountMfa(account.id);
        toast.add({ severity: 'success', summary: '인증 앱 초기화 완료', detail: `${account.displayName} 계정은 다시 로그인 후 인증 앱을 등록해야 합니다.`, life: 3000 });
    } catch (error) {
        toast.add({ severity: 'error', summary: '인증 앱 초기화 실패', detail: failureDetail(error, '인증 앱을 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.'), life: 3600 });
    } finally {
        resettingMfa.value = false;
    }
}

function resetAccountMfa(account) {
    if (resettingMfa.value || isCurrentAccount(account)) return;
    confirm.require({
        header: '인증 앱 초기화',
        message: `${account.displayName} 계정의 인증 앱을 초기화하시겠습니까? 사용자는 다시 로그인해야 합니다.`,
        icon: 'pi pi-shield',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: '인증 앱 초기화', severity: 'danger' },
        accept: () => persistAccountMfaReset(account)
    });
}

async function persistAccountStatus(account) {
    if (actionAccountId.value || (account.isActive && isCurrentAccount(account))) return;
    actionAccountId.value = account.id;
    try {
        const updated = await adminApi.updateAccountStatus(account.id, !account.isActive);
        accounts.value = accounts.value.map((account) => (account.id === updated.id ? updated : account));
        toast.add({
            severity: 'success',
            summary: updated.isActive ? '계정 활성화 완료' : 'ERP 계정 잠금 완료',
            detail: `${updated.displayName} 계정이 ${updated.isActive ? '활성화' : '잠금 처리'}되었습니다.`,
            life: 3000
        });
    } catch (error) {
        toast.add({ severity: 'error', summary: account.isActive ? 'ERP 계정 잠금 실패' : '계정 활성화 실패', detail: failureDetail(error, '계정 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.'), life: 3600 });
    } finally {
        actionAccountId.value = null;
    }
}

function toggleAccountStatus(account) {
    if (account.isActive && isCurrentAccount(account)) return;
    const locking = account.isActive;
    confirm.require({
        header: locking ? 'ERP 계정 잠금' : '계정 활성화',
        message: `${account.displayName} 계정을 ${locking ? '잠금' : '활성화'}하시겠습니까?`,
        icon: locking ? 'pi pi-lock' : 'pi pi-lock-open',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: locking ? '잠금' : '활성화', severity: locking ? 'danger' : 'success' },
        accept: () => persistAccountStatus(account)
    });
}

async function focusFirstError() {
    await nextTick();
    const firstErrorId = ['email', 'temporaryPassword', 'displayName', 'department'].find((field) => formErrors.value[field]);
    document.getElementById(`account-${firstErrorId}`)?.focus();
}

async function persistAccount() {
    saving.value = true;
    try {
        if (dialogMode.value === 'create') {
            const created = await adminApi.createAccount(accountCreatePayload(draft.value));
            accounts.value = [created, ...accounts.value];
            toast.add({ severity: 'success', summary: '계정 등록 완료', detail: `${created.displayName} 계정이 등록되었습니다.`, life: 3000 });
        } else {
            const updated = await adminApi.updateAccount(editingAccount.value.id, accountUpdatePayload(draft.value));
            accounts.value = accounts.value.map((account) => (account.id === updated.id ? updated : account));
            toast.add({ severity: 'success', summary: '계정 수정 완료', detail: `${updated.displayName} 계정 정보가 변경되었습니다.`, life: 3000 });
        }
        closeDialog();
    } catch (error) {
        const fallback = dialogMode.value === 'create' ? '계정을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '계정 정보를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        toast.add({ severity: 'error', summary: dialogMode.value === 'create' ? '계정 등록 실패' : '계정 수정 실패', detail: failureDetail(error, fallback), life: 3600 });
    } finally {
        clearSensitiveDraft();
        saving.value = false;
    }
}

async function saveAccount() {
    submitted.value = true;
    if (Object.keys(formErrors.value).length) {
        await focusFirstError();
        return;
    }

    if (dialogMode.value === 'edit' && editingAccount.value?.isActive && !draft.value.isActive) {
        confirm.require({
            header: '계정 비활성화',
            message: `${editingAccount.value.displayName} 계정을 비활성화하시겠습니까?`,
            icon: 'pi pi-exclamation-triangle',
            rejectProps: { label: '취소', severity: 'secondary', outlined: true },
            acceptProps: { label: '비활성화', severity: 'danger' },
            accept: persistAccount
        });
        return;
    }

    await persistAccount();
}

onMounted(loadAccounts);
</script>

<template>
    <div class="admin-page">
        <div class="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">계정 관리</h1>
                <p class="mt-1 text-muted-color">ERP 사용자 계정과 등급, 사용 상태를 관리합니다.</p>
            </div>
            <Button label="새 계정" icon="pi pi-user-plus" class="shrink-0" @click="openCreateDialog" />
        </div>

        <div class="card account-card">
            <div class="flex flex-col gap-3 mb-5 xl:flex-row xl:items-center xl:justify-between">
                <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:w-auto">
                    <IconField class="sm:col-span-2 xl:w-80">
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="keyword" placeholder="이름, 이메일, 부서 검색" aria-label="계정 검색" fluid />
                    </IconField>
                    <Select v-model="selectedRole" :options="roleFilterOptions" optionLabel="label" optionValue="value" placeholder="전체 등급" aria-label="계정 등급 필터" showClear fluid class="xl:w-40" />
                    <Select v-model="selectedStatus" :options="statusOptions" optionLabel="label" optionValue="value" placeholder="전체 상태" aria-label="계정 상태 필터" showClear fluid class="xl:w-40" />
                </div>
                <div class="text-sm text-muted-color" aria-live="polite">
                    총 <strong class="text-color">{{ filteredAccounts.length }}</strong
                    >개 계정
                </div>
            </div>

            <div v-if="loading" class="admin-state" role="status" aria-live="polite">
                <ProgressSpinner class="state-spinner" strokeWidth="5" />
                <span>계정 정보를 불러오는 중입니다.</span>
            </div>

            <div v-else-if="loadError" class="admin-state" role="alert">
                <i class="pi pi-exclamation-circle text-2xl text-red-600" aria-hidden="true"></i>
                <span>계정 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</span>
                <Button label="계정 목록 다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined @click="loadAccounts" />
            </div>

            <DataTable
                v-else
                :value="filteredAccounts"
                dataKey="id"
                paginator
                :rows="10"
                :rowsPerPageOptions="[10, 20, 50]"
                responsiveLayout="scroll"
                scrollable
                tableStyle="min-width: 58rem"
                :tableProps="{ 'aria-label': 'ERP 계정 목록' }"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
                currentPageReportTemplate="{first} - {last} / {totalRecords}개"
            >
                <template #empty>등록된 계정이 없습니다.</template>
                <Column field="displayName" header="이름" sortable>
                    <template #body="slotProps">
                        <div class="account-name-cell">
                            <span class="account-avatar" aria-hidden="true">{{ [...(slotProps.data.displayName || '계')][0] }}</span>
                            <div class="min-w-0">
                                <strong class="block truncate" :title="slotProps.data.displayName">{{ slotProps.data.displayName }}</strong>
                                <small class="block truncate text-muted-color" :title="slotProps.data.email">{{ slotProps.data.email }}</small>
                            </div>
                        </div>
                    </template>
                </Column>
                <Column field="department" header="부서" sortable />
                <Column field="role" header="계정 등급" sortable>
                    <template #body="slotProps">
                        <Tag :value="roleLabels[slotProps.data.role] || slotProps.data.role" :severity="roleSeverities[slotProps.data.role]" />
                    </template>
                </Column>
                <Column field="isActive" header="상태" sortable>
                    <template #body="slotProps">
                        <Tag :value="slotProps.data.isActive ? '활성' : '비활성'" :severity="slotProps.data.isActive ? 'success' : 'secondary'" />
                    </template>
                </Column>
                <Column header="작업" frozen alignFrozen="right" style="width: 13rem">
                    <template #body="slotProps">
                        <div class="account-actions">
                            <Button icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.displayName} 계정 수정`" :title="`${slotProps.data.displayName} 계정 수정`" @click="openEditDialog(slotProps.data)" />
                            <Button
                                icon="pi pi-key"
                                text
                                rounded
                                severity="secondary"
                                :aria-label="passwordResetActionLabel(slotProps.data)"
                                :title="passwordResetActionLabel(slotProps.data)"
                                :disabled="isCurrentAccount(slotProps.data) || resettingPassword"
                                @click="openPasswordResetDialog(slotProps.data)"
                            />
                            <Button
                                icon="pi pi-shield"
                                text
                                rounded
                                severity="danger"
                                :aria-label="mfaResetActionLabel(slotProps.data)"
                                :title="mfaResetActionLabel(slotProps.data)"
                                :disabled="isCurrentAccount(slotProps.data) || resettingMfa"
                                @click="resetAccountMfa(slotProps.data)"
                            />
                            <Button
                                :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                text
                                rounded
                                :severity="slotProps.data.isActive ? 'danger' : 'success'"
                                :aria-label="statusActionLabel(slotProps.data)"
                                :title="statusActionLabel(slotProps.data)"
                                :disabled="isCurrentAccount(slotProps.data) || Boolean(actionAccountId)"
                                @click="toggleAccountStatus(slotProps.data)"
                            />
                        </div>
                    </template>
                </Column>
            </DataTable>
        </div>

        <Dialog v-model:visible="accountDialog" modal :header="dialogTitle" :style="{ width: '36rem' }" :breakpoints="{ '640px': '94vw' }" :closable="!saving" @hide="clearSensitiveDraft">
            <form id="account-form" class="account-form" novalidate @submit.prevent="saveAccount">
                <div v-if="dialogMode === 'create'" class="field-group">
                    <label for="account-email">Gmail 이메일</label>
                    <InputText id="account-email" v-model.trim="draft.email" type="email" autocomplete="off" required fluid :invalid="submitted && Boolean(formErrors.email)" aria-describedby="account-email-error" />
                    <small v-if="submitted && formErrors.email" id="account-email-error" class="field-error" role="alert">{{ formErrors.email }}</small>
                </div>

                <div v-if="dialogMode === 'create'" class="field-group">
                    <label for="account-temporaryPassword">임시 비밀번호</label>
                    <Password
                        inputId="account-temporaryPassword"
                        v-model="draft.temporaryPassword"
                        type="password"
                        autocomplete="new-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :invalid="submitted && Boolean(formErrors.temporaryPassword)"
                        :inputProps="{ autocomplete: 'new-password', minlength: 8, maxlength: 128, 'aria-describedby': 'account-password-help account-temporaryPassword-error' }"
                    />
                    <small id="account-password-help" class="text-muted-color">최초 로그인에 사용할 8자 이상 128자 이하의 임시 비밀번호입니다.</small>
                    <small v-if="submitted && formErrors.temporaryPassword" id="account-temporaryPassword-error" class="field-error" role="alert">{{ formErrors.temporaryPassword }}</small>
                </div>

                <div class="form-grid">
                    <div class="field-group">
                        <label for="account-displayName">이름</label>
                        <InputText id="account-displayName" v-model.trim="draft.displayName" required fluid :invalid="submitted && Boolean(formErrors.displayName)" aria-describedby="account-displayName-error" />
                        <small v-if="submitted && formErrors.displayName" id="account-displayName-error" class="field-error" role="alert">{{ formErrors.displayName }}</small>
                    </div>
                    <div class="field-group">
                        <label for="account-department">부서</label>
                        <InputText id="account-department" v-model.trim="draft.department" required fluid :invalid="submitted && Boolean(formErrors.department)" aria-describedby="account-department-error" />
                        <small v-if="submitted && formErrors.department" id="account-department-error" class="field-error" role="alert">{{ formErrors.department }}</small>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="field-group">
                        <label id="account-role-label" for="account-role">계정 등급</label>
                        <Select
                            inputId="account-role"
                            v-model="draft.role"
                            :options="dialogMode === 'create' ? createRoleOptions : accountRoleOptions"
                            optionLabel="label"
                            optionValue="value"
                            aria-labelledby="account-role-label"
                            :disabled="isEditingCurrentAccount"
                            fluid
                        />
                        <small v-if="isEditingCurrentAccount" class="text-muted-color">현재 관리자 계정의 등급은 변경할 수 없습니다.</small>
                    </div>
                    <div v-if="dialogMode === 'edit'" class="field-group">
                        <span id="account-active-label" class="field-label">계정 상태</span>
                        <div class="toggle-field">
                            <ToggleSwitch v-model="draft.isActive" :disabled="isEditingCurrentAccount" aria-labelledby="account-active-label account-active-value" />
                            <span id="account-active-value">{{ draft.isActive ? '활성' : '비활성' }}</span>
                        </div>
                        <small v-if="isEditingCurrentAccount" class="text-muted-color">현재 관리자 계정은 비활성화할 수 없습니다.</small>
                    </div>
                </div>
            </form>

            <template #footer>
                <Button label="취소" icon="pi pi-times" severity="secondary" text :disabled="saving" @click="closeDialog" />
                <Button :label="dialogMode === 'create' ? '등록' : '저장'" icon="pi pi-check" type="submit" form="account-form" :loading="saving" />
            </template>
        </Dialog>

        <Dialog
            v-model:visible="passwordResetDialog"
            modal
            :header="`${passwordResetAccount?.displayName || '계정'} 비밀번호 재설정`"
            :style="{ width: '32rem' }"
            :breakpoints="{ '640px': 'calc(100vw - 2rem)' }"
            :closable="!resettingPassword"
            :closeOnEscape="!resettingPassword"
            @show="focusPasswordResetField"
            @hide="clearPasswordResetDraft"
        >
            <form id="password-reset-form" class="account-form" novalidate @submit.prevent="resetAccountPassword">
                <div class="field-group">
                    <label for="reset-temporaryPassword">임시 비밀번호</label>
                    <Password
                        inputId="reset-temporaryPassword"
                        v-model="passwordResetDraft.temporaryPassword"
                        autocomplete="new-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :disabled="resettingPassword"
                        :invalid="passwordResetSubmitted && Boolean(passwordResetErrors.temporaryPassword)"
                        :inputProps="{ autocomplete: 'new-password', minlength: 8, maxlength: 128, 'aria-describedby': 'reset-password-help reset-temporaryPassword-error' }"
                    />
                    <small id="reset-password-help" class="text-muted-color">사용자에게 안전한 경로로 전달할 8자 이상 128자 이하의 임시 비밀번호입니다.</small>
                    <small v-if="passwordResetSubmitted && passwordResetErrors.temporaryPassword" id="reset-temporaryPassword-error" class="field-error" role="alert">{{ passwordResetErrors.temporaryPassword }}</small>
                </div>
                <div class="field-group">
                    <label for="reset-confirmation">임시 비밀번호 확인</label>
                    <Password
                        inputId="reset-confirmation"
                        v-model="passwordResetDraft.confirmation"
                        autocomplete="new-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :disabled="resettingPassword"
                        :invalid="passwordResetSubmitted && Boolean(passwordResetErrors.confirmation)"
                        :inputProps="{ autocomplete: 'new-password', maxlength: 128, 'aria-describedby': 'reset-confirmation-error' }"
                    />
                    <small v-if="passwordResetSubmitted && passwordResetErrors.confirmation" id="reset-confirmation-error" class="field-error" role="alert">{{ passwordResetErrors.confirmation }}</small>
                </div>
            </form>

            <template #footer>
                <Button label="취소" icon="pi pi-times" severity="secondary" text :disabled="resettingPassword" @click="closePasswordResetDialog" />
                <Button label="재설정" icon="pi pi-key" type="submit" form="password-reset-form" :loading="resettingPassword" :disabled="resettingPassword || Boolean(Object.keys(passwordResetErrors).length)" />
            </template>
        </Dialog>

        <ConfirmDialog />
    </div>
</template>

<style scoped>
.admin-page,
.account-card,
.account-form,
.field-group {
    min-width: 0;
}

.admin-state {
    min-height: 15rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    color: var(--text-color-secondary);
    text-align: center;
}

.state-spinner {
    width: 2.5rem;
    height: 2.5rem;
}

.account-name-cell {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    max-width: 18rem;
}

.account-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    white-space: nowrap;
}

.account-avatar {
    width: 2.25rem;
    height: 2.25rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, var(--surface-card));
    font-weight: 700;
}

.account-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.field-group label,
.field-label {
    font-weight: 600;
}

.field-error {
    color: var(--p-red-600);
}

.toggle-field {
    min-height: 2.625rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

@media (max-width: 640px) {
    .form-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
