<script setup>
import { MASTER_MESSAGES, formatBusinessNumber, normalizeBusinessNumber, normalizeCode, normalizeText, validatePartnerDraft } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';

const READ_ONLY_MESSAGE = '거래처 등록 및 수정은 관리자 계정에서만 할 수 있습니다. 현재 계정은 조회만 가능합니다.';
const PARTNER_MESSAGES = Object.freeze({
    companyId: MASTER_MESSAGES.company,
    code: MASTER_MESSAGES.code,
    name: '거래처명을 입력해 주세요.',
    roles: '고객 또는 공급업체 역할을 하나 이상 선택해 주세요.',
    businessNumber: MASTER_MESSAGES.businessNumber,
    email: '올바른 이메일 주소를 입력해 주세요.'
});
const roleOptions = Object.freeze([
    { label: '전체 역할', value: 'all' },
    { label: '고객', value: 'customer' },
    { label: '공급업체', value: 'vendor' },
    { label: '고객 · 공급업체', value: 'dual' }
]);
const statusOptions = Object.freeze([
    { label: '전체 상태', value: 'all' },
    { label: '활성', value: 'active' },
    { label: '비활성', value: 'inactive' }
]);

const authStore = useAuthStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, loading, error, partnersFor, ensureLoaded, createPartner, updatePartner } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const selectedCompanyId = ref(null);
const keyword = ref('');
const selectedRole = ref('all');
const selectedStatus = ref('all');
const saving = ref(false);
const changingId = ref(null);

const partnerDialog = ref(false);
const partnerMode = ref('create');
const editingPartner = ref(null);
const submitted = ref(false);

const createPartnerDraft = (partner = null) => ({
    companyId: partner?.companyId ?? '',
    code: partner?.code ?? '',
    name: partner?.name ?? '',
    businessNumber: partner?.businessNumber ? formatBusinessNumber(partner.businessNumber) : '',
    isCustomer: partner?.isCustomer === true,
    isVendor: partner?.isVendor === true,
    representative: partner?.representative ?? '',
    email: partner?.email ?? '',
    phone: partner?.phone ?? '',
    address: partner?.address ?? '',
    isActive: partner ? partner.isActive === true : true
});

const partnerDraft = ref(createPartnerDraft());
const validation = computed(() => validatePartnerDraft(partnerDraft.value));
const dialogTitle = computed(() => (partnerMode.value === 'create' ? '거래처 등록' : '거래처 정보 수정'));
const companyOptions = computed(() =>
    companies.value.map((company) => ({
        label: `${company.code} · ${company.name}${company.isActive ? '' : ' (비활성)'}`,
        value: company.id
    }))
);

const filteredPartners = computed(() => {
    if (!selectedCompanyId.value) return [];

    const rawQuery = keyword.value.trim();
    const query = rawQuery.toLocaleLowerCase('ko-KR');
    const digitQuery = rawQuery && /^[\d\s-]+$/.test(rawQuery) ? normalizeBusinessNumber(rawQuery) : null;

    return partnersFor(selectedCompanyId.value).filter((partner) => {
        const matchesKeyword =
            !query ||
            [partner.code, partner.name, formatBusinessNumber(partner.businessNumber)].some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(query)) ||
            Boolean(digitQuery && partner.businessNumber?.includes(digitQuery));
        const matchesRole =
            selectedRole.value === 'all' ||
            (selectedRole.value === 'customer' && partner.isCustomer) ||
            (selectedRole.value === 'vendor' && partner.isVendor) ||
            (selectedRole.value === 'dual' && partner.isCustomer && partner.isVendor);
        const matchesStatus = selectedStatus.value === 'all' || (selectedStatus.value === 'active' && partner.isActive) || (selectedStatus.value === 'inactive' && !partner.isActive);
        return matchesKeyword && matchesRole && matchesStatus;
    });
});

ensureLoaded();

watch(
    companies,
    (rows) => {
        if (rows.some((company) => company.id === selectedCompanyId.value)) return;
        selectedCompanyId.value = rows.find((company) => company.isActive)?.id ?? rows[0]?.id ?? null;
    },
    { immediate: true }
);

const notify = (severity, summary, detail) => toast.add({ severity, summary, detail, life: severity === 'success' ? 3000 : 3200 });
const failureDetail = (cause) => MASTER_ERROR_MESSAGES[cause?.code] || MASTER_ERROR_MESSAGES.master_save_failed;
const activeLabel = (partner) => (partner.isActive ? '활성' : '비활성');

const partnerPayload = (draft) => ({
    companyId: normalizeText(draft.companyId),
    code: normalizeCode(draft.code),
    name: normalizeText(draft.name),
    businessNumber: normalizeBusinessNumber(draft.businessNumber),
    isCustomer: draft.isCustomer === true,
    isVendor: draft.isVendor === true,
    representative: normalizeText(draft.representative),
    email: normalizeText(draft.email),
    phone: normalizeText(draft.phone),
    address: normalizeText(draft.address),
    isActive: draft.isActive === true
});

const errorMessage = (field) => (submitted.value && validation.value.errors[field] ? PARTNER_MESSAGES[field] : '');

async function focusFirstError() {
    await nextTick();
    const ids = {
        companyId: 'partner-company',
        code: 'partner-code',
        name: 'partner-name',
        roles: 'partner-isCustomer',
        businessNumber: 'partner-businessNumber',
        email: 'partner-email'
    };
    const first = ['companyId', 'code', 'name', 'roles', 'businessNumber', 'email'].find((field) => validation.value.errors[field]);
    if (first) document.getElementById(ids[first])?.focus();
}

function openCreatePartner() {
    partnerMode.value = 'create';
    editingPartner.value = null;
    partnerDraft.value = createPartnerDraft();
    submitted.value = false;
    partnerDialog.value = true;
}

function openEditPartner(partner) {
    partnerMode.value = 'edit';
    editingPartner.value = partner;
    partnerDraft.value = createPartnerDraft(partner);
    submitted.value = false;
    partnerDialog.value = true;
}

async function savePartner() {
    submitted.value = true;
    if (!validation.value.isValid) {
        await focusFirstError();
        return;
    }

    saving.value = true;
    try {
        const payload = partnerPayload(partnerDraft.value);
        const saved = partnerMode.value === 'create' ? await createPartner(payload) : await updatePartner(editingPartner.value.id, payload);
        partnerDialog.value = false;
        selectedCompanyId.value = saved.companyId;
        notify('success', partnerMode.value === 'create' ? '거래처 등록 완료' : '거래처 수정 완료', `${saved.name} 거래처 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '거래처 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function togglePartnerActive(partner) {
    const activating = !partner.isActive;
    confirm.require({
        group: 'master',
        message: `${partner.name} 거래처를 ${activating ? '활성화' : '비활성화'}하시겠습니까?`,
        header: activating ? '거래처 활성화' : '거래처 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            changingId.value = partner.id;
            try {
                await updatePartner(partner.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${partner.name} 거래처가 ${activating ? '활성화' : '비활성화'}되었습니다.`);
            } catch (cause) {
                notify('error', '상태 변경 실패', failureDetail(cause));
            } finally {
                changingId.value = null;
            }
        }
    });
}
</script>

<template>
    <div>
        <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">거래처 관리</h1>
                <div class="mt-1 text-muted-color">회사별 고객과 공급업체 정보를 한 곳에서 관리합니다.</div>
            </div>
            <Button v-if="canManage" label="거래처 등록" icon="pi pi-plus" @click="openCreatePartner" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6" role="alert">{{ error }}</Message>
        <Message v-if="!canManage" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>
        <div class="sr-only" role="status" aria-live="polite">
            {{ loading ? '거래처 목록을 불러오는 중입니다.' : `거래처 ${filteredPartners.length}개가 표시되었습니다.` }}
        </div>

        <section class="card partner-card mb-0" aria-labelledby="partner-list-title">
            <div class="flex flex-col gap-4 mb-4">
                <h2 id="partner-list-title" class="text-xl font-semibold">거래처 목록</h2>
                <div class="grid grid-cols-12 gap-3">
                    <div class="col-span-12 md:col-span-6 xl:col-span-3">
                        <label for="partner-company-filter" class="block mb-2 text-sm font-medium">회사</label>
                        <Select
                            v-model="selectedCompanyId"
                            inputId="partner-company-filter"
                            :options="companyOptions"
                            optionLabel="label"
                            optionValue="value"
                            placeholder="회사를 선택하세요"
                            aria-describedby="partner-company-filter-help"
                            fluid
                        />
                        <small id="partner-company-filter-help" class="sr-only">조회할 회사를 선택합니다.</small>
                    </div>
                    <div class="col-span-12 md:col-span-6 xl:col-span-4">
                        <label for="partner-keyword" class="block mb-2 text-sm font-medium">검색</label>
                        <IconField>
                            <InputIcon class="pi pi-search" />
                            <InputText id="partner-keyword" v-model="keyword" placeholder="코드, 거래처명, 사업자등록번호" aria-describedby="partner-keyword-help" fluid />
                        </IconField>
                        <small id="partner-keyword-help" class="sr-only">코드, 거래처명 또는 사업자등록번호로 검색합니다.</small>
                    </div>
                    <div class="col-span-6 md:col-span-6 xl:col-span-3">
                        <label for="partner-role-filter" class="block mb-2 text-sm font-medium">역할</label>
                        <Select v-model="selectedRole" inputId="partner-role-filter" :options="roleOptions" optionLabel="label" optionValue="value" fluid />
                    </div>
                    <div class="col-span-6 md:col-span-6 xl:col-span-2">
                        <label for="partner-status-filter" class="block mb-2 text-sm font-medium">상태</label>
                        <Select v-model="selectedStatus" inputId="partner-status-filter" :options="statusOptions" optionLabel="label" optionValue="value" fluid />
                    </div>
                </div>
            </div>

            <DataTable
                :value="filteredPartners"
                dataKey="id"
                :loading="loading"
                size="small"
                responsiveLayout="scroll"
                tableStyle="min-width: 62rem"
                :tableProps="{ 'aria-label': '거래처 목록' }"
                stripedRows
                scrollable
            >
                <template #empty>조건에 맞는 거래처가 없습니다.</template>
                <Column field="code" header="코드" sortable>
                    <template #body="slotProps"><span class="font-medium text-primary">{{ slotProps.data.code }}</span></template>
                </Column>
                <Column field="name" header="거래처명" sortable style="min-width: 11rem" />
                <Column header="역할" style="min-width: 10rem">
                    <template #body="slotProps">
                        <div class="flex flex-wrap gap-1">
                            <Tag v-if="slotProps.data.isCustomer" value="고객" severity="info" />
                            <Tag v-if="slotProps.data.isVendor" value="공급업체" severity="warn" />
                        </div>
                    </template>
                </Column>
                <Column header="사업자등록번호">
                    <template #body="slotProps">{{ formatBusinessNumber(slotProps.data.businessNumber) || '-' }}</template>
                </Column>
                <Column field="representative" header="대표자">
                    <template #body="slotProps">{{ slotProps.data.representative || '-' }}</template>
                </Column>
                <Column field="phone" header="연락처">
                    <template #body="slotProps">{{ slotProps.data.phone || '-' }}</template>
                </Column>
                <Column field="isActive" header="상태" sortable>
                    <template #body="slotProps"><Tag :value="activeLabel(slotProps.data)" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                    <template #body="slotProps">
                        <div class="flex gap-1">
                            <Button
                                icon="pi pi-pencil"
                                text
                                rounded
                                size="small"
                                :aria-label="`${slotProps.data.name} 거래처 수정`"
                                :title="`${slotProps.data.name} 거래처 수정`"
                                @click="openEditPartner(slotProps.data)"
                            />
                            <Button
                                :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                text
                                rounded
                                size="small"
                                :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                :loading="changingId === slotProps.data.id"
                                :disabled="changingId !== null"
                                :aria-label="`${slotProps.data.name} 거래처 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                :title="`${slotProps.data.name} 거래처 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                @click="togglePartnerActive(slotProps.data)"
                            />
                        </div>
                    </template>
                </Column>
            </DataTable>
        </section>

        <Dialog v-model:visible="partnerDialog" modal :header="dialogTitle" :style="{ width: '44rem' }" :breakpoints="{ '768px': '94vw' }">
            <form id="partner-form" class="grid grid-cols-12 gap-4" novalidate :aria-busy="saving" @submit.prevent="savePartner">
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-company" class="block mb-2 font-medium">회사</label>
                    <Select
                        v-model="partnerDraft.companyId"
                        inputId="partner-company"
                        :options="companyOptions"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="회사를 선택하세요"
                        aria-describedby="partner-company-error"
                        :invalid="submitted && validation.errors.companyId"
                        :disabled="saving"
                        fluid
                    />
                    <small v-if="errorMessage('companyId')" id="partner-company-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('companyId') }}</small>
                </div>
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-code" class="block mb-2 font-medium">거래처 코드</label>
                    <InputText
                        id="partner-code"
                        v-model="partnerDraft.code"
                        required
                        class="uppercase"
                        placeholder="예: CUS-001"
                        aria-describedby="partner-code-error"
                        :invalid="submitted && validation.errors.code"
                        :disabled="saving"
                        fluid
                    />
                    <small v-if="errorMessage('code')" id="partner-code-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('code') }}</small>
                </div>
                <div class="col-span-12">
                    <label for="partner-name" class="block mb-2 font-medium">거래처명</label>
                    <InputText
                        id="partner-name"
                        v-model="partnerDraft.name"
                        required
                        placeholder="거래처명을 입력하세요"
                        aria-describedby="partner-name-error"
                        :invalid="submitted && validation.errors.name"
                        :disabled="saving"
                        fluid
                    />
                    <small v-if="errorMessage('name')" id="partner-name-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('name') }}</small>
                </div>
                <fieldset id="partner-roles" class="col-span-12" aria-describedby="partner-roles-error">
                    <legend class="mb-2 font-medium">거래처 역할</legend>
                    <div class="flex flex-wrap gap-5">
                        <div class="flex items-center gap-2">
                            <Checkbox inputId="partner-isCustomer" v-model="partnerDraft.isCustomer" binary :invalid="submitted && validation.errors.roles" :disabled="saving" />
                            <label for="partner-isCustomer">고객</label>
                        </div>
                        <div class="flex items-center gap-2">
                            <Checkbox inputId="partner-isVendor" v-model="partnerDraft.isVendor" binary :invalid="submitted && validation.errors.roles" :disabled="saving" />
                            <label for="partner-isVendor">공급업체</label>
                        </div>
                    </div>
                    <small v-if="errorMessage('roles')" id="partner-roles-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('roles') }}</small>
                </fieldset>
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-businessNumber" class="block mb-2 font-medium">사업자등록번호</label>
                    <InputText
                        id="partner-businessNumber"
                        v-model="partnerDraft.businessNumber"
                        inputmode="numeric"
                        placeholder="000-00-00000"
                        aria-describedby="partner-businessNumber-error"
                        :invalid="submitted && validation.errors.businessNumber"
                        :disabled="saving"
                        fluid
                    />
                    <small v-if="errorMessage('businessNumber')" id="partner-businessNumber-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('businessNumber') }}</small>
                </div>
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-representative" class="block mb-2 font-medium">대표자</label>
                    <InputText id="partner-representative" v-model="partnerDraft.representative" placeholder="대표자명을 입력하세요" :disabled="saving" fluid />
                </div>
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-email" class="block mb-2 font-medium">담당 이메일</label>
                    <InputText
                        id="partner-email"
                        v-model="partnerDraft.email"
                        type="email"
                        placeholder="contact@example.com"
                        aria-describedby="partner-email-error"
                        :invalid="submitted && validation.errors.email"
                        :disabled="saving"
                        fluid
                    />
                    <small v-if="errorMessage('email')" id="partner-email-error" class="text-red-700 dark:text-red-400" role="alert">{{ errorMessage('email') }}</small>
                </div>
                <div class="col-span-12 md:col-span-6">
                    <label for="partner-phone" class="block mb-2 font-medium">대표 전화</label>
                    <InputText id="partner-phone" v-model="partnerDraft.phone" type="tel" placeholder="02-0000-0000" :disabled="saving" fluid />
                </div>
                <div class="col-span-12">
                    <label for="partner-address" class="block mb-2 font-medium">주소</label>
                    <InputText id="partner-address" v-model="partnerDraft.address" placeholder="주소를 입력하세요" :disabled="saving" fluid />
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text :disabled="saving" @click="partnerDialog = false" />
                    <Button type="submit" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <ConfirmDialog group="master" />
    </div>
</template>

<style scoped>
.partner-card {
    border-radius: 0.5rem;
}
</style>
