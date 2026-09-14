<script setup>
import { erpMenu } from '@/data/erp';
import { useAccessStore } from '@/stores/access';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref, watch } from 'vue';
import { buildPermissionGroups, permissionKeysEqual } from './adminModels';

const accessStore = useAccessStore();
const confirm = useConfirm();
const toast = useToast();

const roleOptions = [
    { label: '관리자', value: 'admin', locked: true },
    { label: '결재자', value: 'approver' },
    { label: '사용자', value: 'user' }
];
const allPermissionGroups = buildPermissionGroups(erpMenu).map((group) => ({ ...group, items: group.items.filter((item) => item.menuKey !== 'hr.core') }));
const selectedRole = ref('user');
const permissionRows = ref({});
const draftKeys = ref([]);
const baselineKeys = ref([]);
const loading = ref(true);
const saving = ref(false);
const loadError = ref(false);

const selectedPermission = computed(() => permissionRows.value[selectedRole.value] || null);
const dirty = computed(() => !permissionKeysEqual(draftKeys.value, baselineKeys.value));
const selectedRoleLabel = computed(() => roleOptions.find((role) => role.value === selectedRole.value)?.label || selectedRole.value);
const visiblePermissionGroups = computed(() =>
    allPermissionGroups
        .map((group) => ({
            ...group,
            items: selectedRole.value === 'admin' ? group.items : group.items.filter((item) => !item.fixed)
        }))
        .filter((group) => group.items.length)
);

function syncDraft() {
    const keys = selectedPermission.value?.allowed_menu_keys || [];
    draftKeys.value = [...keys];
    baselineKeys.value = [...keys];
}

async function loadPermissions() {
    loading.value = true;
    loadError.value = false;
    try {
        const rows = await accessStore.loadAll();
        permissionRows.value = Object.fromEntries(rows.map((row) => [row.role, row]));
        syncDraft();
    } catch {
        permissionRows.value = {};
        draftKeys.value = [];
        baselineKeys.value = [];
        loadError.value = true;
    } finally {
        loading.value = false;
    }
}

function applyRole(role) {
    selectedRole.value = role;
    syncDraft();
}

function selectRole(role) {
    if (role === selectedRole.value) return;
    if (!dirty.value) {
        applyRole(role);
        return;
    }

    confirm.require({
        header: '변경 사항 취소',
        message: '저장하지 않은 메뉴 권한 변경을 취소하고 계정 등급을 바꾸시겠습니까?',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '계속 편집', severity: 'secondary', outlined: true },
        acceptProps: { label: '변경 취소' },
        accept: () => applyRole(role)
    });
}

function hasPermission(menuKey) {
    return draftKeys.value.includes(menuKey);
}

function togglePermission(item, enabled) {
    if (selectedRole.value === 'admin' || item.fixed) return;
    const keys = new Set(draftKeys.value);
    if (enabled) keys.add(item.menuKey);
    else keys.delete(item.menuKey);
    draftKeys.value = [...keys];
}

function permissionToggleLabel(item) {
    const state = hasPermission(item.menuKey) ? '허용됨' : '차단됨';
    return `${selectedRoleLabel.value} ${item.label} 메뉴 권한, ${state}`;
}

function resetPermissions() {
    draftKeys.value = [...baselineKeys.value];
    toast.add({ severity: 'info', summary: '변경 취소', detail: `${selectedRoleLabel.value} 메뉴 권한을 저장 전 상태로 되돌렸습니다.`, life: 2600 });
}

async function savePermissions() {
    if (selectedRole.value === 'admin' || !dirty.value || !selectedPermission.value || saving.value) return;

    saving.value = true;
    try {
        const saved = await accessStore.save(selectedRole.value, draftKeys.value, selectedPermission.value.revision);
        permissionRows.value = { ...permissionRows.value, [saved.role]: saved };
        syncDraft();
        toast.add({ severity: 'success', summary: '메뉴 권한 저장 완료', detail: `${selectedRoleLabel.value} 메뉴 권한을 저장했습니다.`, life: 3000 });
    } catch (error) {
        if (error?.code === 'revision_conflict') {
            toast.add({ severity: 'warn', summary: '권한 변경 충돌', detail: '다른 관리자의 변경 사항을 불러왔습니다. 내용을 확인한 후 다시 저장해 주세요.', life: 4200 });
            await loadPermissions();
        } else {
            toast.add({ severity: 'error', summary: '메뉴 권한 저장 실패', detail: '메뉴 권한을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3600 });
        }
    } finally {
        saving.value = false;
    }
}

watch(selectedRole, syncDraft);
onMounted(loadPermissions);
</script>

<template>
    <p class="mb-4 text-muted-color">인사 메뉴는 전사 권한관리에서 회사별 정책으로 설정하고 발행해야 사용할 수 있습니다.</p>
    <div class="admin-page permission-page">
        <div class="flex flex-col gap-3 mb-6 lg:flex-row lg:items-end lg:justify-between">
            <div class="min-w-0">
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">메뉴 권한 관리</h1>
                <p class="mt-1 text-muted-color">계정 등급별로 사이드바와 직접 경로의 접근 권한을 함께 설정합니다.</p>
            </div>
            <div class="role-control">
                <label id="permission-role-label" for="permission-role" class="font-medium">계정 등급</label>
                <Select
                    inputId="permission-role"
                    :modelValue="selectedRole"
                    :options="roleOptions"
                    optionLabel="label"
                    optionValue="value"
                    aria-label="관리할 계정 등급"
                    aria-labelledby="permission-role-label"
                    class="w-full sm:w-48"
                    @update:modelValue="selectRole"
                >
                    <template #option="slotProps">
                        <div class="flex items-center gap-2">
                            <span>{{ slotProps.option.label }}</span>
                            <i v-if="slotProps.option.locked" class="pi pi-lock text-xs text-muted-color" aria-hidden="true"></i>
                        </div>
                    </template>
                </Select>
            </div>
        </div>

        <div class="card permission-card">
            <div v-if="loading" class="admin-state" role="status" aria-live="polite">
                <ProgressSpinner class="state-spinner" strokeWidth="5" />
                <span>메뉴 권한을 불러오는 중입니다.</span>
            </div>

            <div v-else-if="loadError" class="admin-state" role="alert">
                <i class="pi pi-exclamation-circle text-2xl text-red-600" aria-hidden="true"></i>
                <span>메뉴 권한을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</span>
                <Button label="메뉴 권한 다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined @click="loadPermissions" />
            </div>

            <template v-else-if="selectedPermission && visiblePermissionGroups.length">
                <div class="permission-toolbar">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <strong>{{ selectedRoleLabel }} 메뉴 접근</strong>
                            <Tag v-if="selectedRole === 'admin'" value="고정 권한" icon="pi pi-lock" severity="secondary" />
                            <Tag v-else :value="`개정 ${selectedPermission.revision}`" severity="info" />
                        </div>
                        <p v-if="selectedRole === 'admin'" class="mt-2 text-sm text-muted-color">관리자 메뉴 권한은 시스템 접근 보호를 위해 변경할 수 없습니다.</p>
                        <p v-else-if="dirty" class="mt-2 text-sm font-medium text-primary" role="status">저장되지 않은 변경 사항이 있습니다.</p>
                        <p v-else class="mt-2 text-sm text-muted-color">저장된 메뉴 권한과 일치합니다.</p>
                    </div>
                    <div v-if="selectedRole !== 'admin'" class="permission-actions">
                        <Button label="초기화" icon="pi pi-undo" severity="secondary" outlined :disabled="!dirty || saving" @click="resetPermissions" />
                        <Button label="저장" icon="pi pi-save" :disabled="!dirty" :loading="saving" @click="savePermissions" />
                    </div>
                </div>

                <div class="permission-groups">
                    <section v-for="group in visiblePermissionGroups" :key="group.label" class="permission-group" :aria-labelledby="`permission-group-${group.label}`">
                        <h2 :id="`permission-group-${group.label}`">{{ group.label }}</h2>
                        <div class="permission-list">
                            <div v-for="item in group.items" :key="item.menuKey" class="permission-row">
                                <div class="permission-copy">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <strong>{{ item.label }}</strong>
                                        <span class="permission-category">{{ item.category }}</span>
                                        <i v-if="item.fixed" class="pi pi-lock text-xs text-muted-color" aria-hidden="true"></i>
                                    </div>
                                    <small>{{ item.description }}</small>
                                </div>
                                <ToggleSwitch :modelValue="hasPermission(item.menuKey)" :disabled="selectedRole === 'admin' || item.fixed" :aria-label="permissionToggleLabel(item)" @update:modelValue="togglePermission(item, $event)" />
                            </div>
                        </div>
                    </section>
                </div>
            </template>

            <div v-else class="admin-state" role="status">
                <i class="pi pi-folder-open text-2xl" aria-hidden="true"></i>
                <span>표시할 메뉴 권한이 없습니다.</span>
                <Button label="메뉴 권한 다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined @click="loadPermissions" />
            </div>
        </div>

        <ConfirmDialog />
    </div>
</template>

<style scoped>
.admin-page,
.permission-page,
.permission-card,
.permission-copy {
    min-width: 0;
}

.role-control {
    width: min(100%, 18rem);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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

.permission-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--surface-border);
}

.permission-actions {
    display: flex;
    gap: 0.75rem;
    flex-shrink: 0;
}

.permission-groups {
    max-width: 100%;
    overflow-x: auto;
}

.permission-group {
    min-width: 34rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid var(--surface-border);
}

.permission-group:last-child {
    border-bottom: 0;
    padding-bottom: 0;
}

.permission-group h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    font-weight: 700;
}

.permission-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 1.5rem;
}

.permission-row {
    min-height: 4.75rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--surface-border) 65%, transparent);
}

.permission-copy small {
    display: block;
    margin-top: 0.35rem;
    color: var(--text-color-secondary);
    line-height: 1.4;
}

.permission-category {
    color: var(--text-color-secondary);
    font-size: 0.75rem;
    font-weight: 500;
}

@media (max-width: 780px) {
    .permission-toolbar {
        flex-direction: column;
    }

    .permission-actions {
        width: 100%;
    }

    .permission-actions :deep(.p-button) {
        flex: 1;
    }

    .permission-list {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
