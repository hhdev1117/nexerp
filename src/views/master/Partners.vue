<script setup>
import { formatBusinessNumber, normalizeBusinessNumber, normalizeCode, normalizeText, validatePartnerDraft } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';

const authStore = useAuthStore();
const runtime = useEnterpriseRuntimeStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, partners, loading, error, ensureLoaded, createPartner, updatePartner } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const contextReady = ref(false);
const keyword = ref('');
const selectedCompanyId = ref('all');
const roleFilter = ref('all');
const statusFilter = ref('active');
const dialogVisible = ref(false);
const mode = ref('create');
const editingPartner = ref(null);
const submitted = ref(false);
const saving = ref(false);

const emptyDraft = (partner = null) => ({
    companyId: partner?.companyId ?? '', code: partner?.code ?? '', name: partner?.name ?? '',
    businessNumber: partner ? formatBusinessNumber(partner.businessNumber) : '',
    isCustomer: partner?.isCustomer === true, isVendor: partner?.isVendor === true,
    representative: partner?.representative ?? '', contactName: partner?.contactName ?? '',
    phone: partner?.phone ?? '', email: partner?.email ?? '', address: partner?.address ?? '',
    paymentTermsDays: partner?.paymentTermsDays ?? 30, creditLimit: partner?.creditLimit ?? 0,
    isActive: partner ? partner.isActive === true : true
});
const draft = ref(emptyDraft());
const validation = computed(() => validatePartnerDraft(draft.value));
const numericInvalid = computed(() => !Number.isInteger(draft.value.paymentTermsDays) || draft.value.paymentTermsDays < 0 || typeof draft.value.creditLimit !== 'number' || draft.value.creditLimit < 0);
const dialogTitle = computed(() => (mode.value === 'create' ? '거래처 등록' : '거래처 정보 수정'));
const legacy = computed(() => runtime.context.value?.mode === 'legacy');
const permittedCompanyId = computed(() => (legacy.value ? null : runtime.context.value?.companyId ?? null));
const visibleCompanies = computed(() => companies.value.filter((company) => !permittedCompanyId.value || company.id === permittedCompanyId.value));
const companyOptions = computed(() => [{ label: '전체 회사', value: 'all' }, ...visibleCompanies.value.map((company) => ({ label: `${company.code} · ${company.name}`, value: company.id }))]);
const editableCompanyOptions = computed(() => visibleCompanies.value.filter((company) => company.isActive || company.id === draft.value.companyId).map((company) => ({ label: `${company.code} · ${company.name}`, value: company.id })));
const roleOptions = Object.freeze([{ label: '전체 역할', value: 'all' }, { label: '고객', value: 'customer' }, { label: '공급처', value: 'vendor' }, { label: '고객·공급처', value: 'dual' }]);
const statusOptions = Object.freeze([{ label: '전체 상태', value: 'all' }, { label: '활성', value: 'active' }, { label: '비활성', value: 'inactive' }]);

const filteredPartners = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');
    return partners.value.filter((partner) => {
        if (permittedCompanyId.value && partner.companyId !== permittedCompanyId.value) return false;
        if (selectedCompanyId.value !== 'all' && partner.companyId !== selectedCompanyId.value) return false;
        if (roleFilter.value === 'customer' && !partner.isCustomer) return false;
        if (roleFilter.value === 'vendor' && !partner.isVendor) return false;
        if (roleFilter.value === 'dual' && !(partner.isCustomer && partner.isVendor)) return false;
        if (statusFilter.value === 'active' && !partner.isActive) return false;
        if (statusFilter.value === 'inactive' && partner.isActive) return false;
        return !query || [partner.code, partner.name, partner.businessNumber, partner.representative, partner.contactName, partner.phone, partner.email].some((value) => String(value ?? '').toLocaleLowerCase('ko-KR').includes(query));
    });
});

const companyName = (id) => companies.value.find((company) => company.id === id)?.name ?? '-';
const roleLabel = (partner) => partner.isCustomer && partner.isVendor ? '고객·공급처' : partner.isCustomer ? '고객' : '공급처';
const payload = () => ({
    companyId: normalizeText(draft.value.companyId), code: normalizeCode(draft.value.code), name: normalizeText(draft.value.name),
    businessNumber: normalizeBusinessNumber(draft.value.businessNumber), isCustomer: draft.value.isCustomer === true, isVendor: draft.value.isVendor === true,
    representative: normalizeText(draft.value.representative), contactName: normalizeText(draft.value.contactName), phone: normalizeText(draft.value.phone),
    email: normalizeText(draft.value.email), address: normalizeText(draft.value.address), paymentTermsDays: draft.value.paymentTermsDays,
    creditLimit: draft.value.creditLimit, isActive: draft.value.isActive === true
});
const notify = (severity, summary, detail) => toast.add({ severity, summary, detail, life: severity === 'success' ? 3000 : 3400 });

let contextSequence = 0;
watch(runtime.context, async (context) => {
    const sequence = ++contextSequence;
    contextReady.value = false;
    dialogVisible.value = false;
    if (!context) return;
    if (context.mode === 'legacy') await ensureLoaded(); else await masterStore.reload();
    if (sequence !== contextSequence || error.value) return;
    contextReady.value = true;
    selectedCompanyId.value = context.mode === 'legacy' ? 'all' : context.companyId;
}, { immediate: true, flush: 'sync' });

function openCreate() {
    if (!canManage.value) return;
    mode.value = 'create';
    editingPartner.value = null;
    draft.value = emptyDraft();
    draft.value.companyId = selectedCompanyId.value !== 'all' ? selectedCompanyId.value : visibleCompanies.value.find((company) => company.isActive)?.id ?? '';
    submitted.value = false;
    dialogVisible.value = true;
}

function openEdit(partner) {
    if (!canManage.value) return;
    mode.value = 'edit';
    editingPartner.value = partner;
    draft.value = emptyDraft(partner);
    submitted.value = false;
    dialogVisible.value = true;
}

async function save() {
    if (!canManage.value) return;
    submitted.value = true;
    if (!validation.value.isValid || numericInvalid.value) {
        await nextTick();
        const order = ['companyId', 'code', 'name', 'roles', 'businessNumber', 'email'];
        const first = order.find((field) => validation.value.errors[field]);
        document.getElementById(`partner-${first === 'roles' ? 'isCustomer' : first || 'paymentTermsDays'}`)?.focus();
        return;
    }
    saving.value = true;
    try {
        const saved = mode.value === 'create' ? await createPartner(payload()) : await updatePartner(editingPartner.value.id, payload());
        dialogVisible.value = false;
        notify('success', mode.value === 'create' ? '거래처 등록 완료' : '거래처 수정 완료', `${saved.name} 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '거래처 저장 실패', MASTER_ERROR_MESSAGES[cause?.code] || MASTER_ERROR_MESSAGES.master_save_failed);
    } finally {
        saving.value = false;
    }
}

function toggleActive(partner) {
    if (!canManage.value) return;
    const activating = !partner.isActive;
    confirm.require({
        group: 'partners', header: activating ? '거래처 활성화' : '거래처 비활성화',
        message: `${partner.name} 거래처를 ${activating ? '활성화' : '비활성화'}하시겠습니까?`, icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true }, acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            if (!canManage.value) return;
            try {
                await updatePartner(partner.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${partner.name} 거래처가 ${activating ? '활성화' : '비활성화'}되었습니다.`);
            } catch (cause) {
                notify('error', '상태 변경 실패', MASTER_ERROR_MESSAGES[cause?.code] || MASTER_ERROR_MESSAGES.master_save_failed);
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
                <p class="mt-1 text-muted-color">고객과 공급처를 하나의 원장으로 관리합니다. 한 거래처에 두 역할을 함께 지정할 수 있습니다.</p>
            </div>
            <Button v-if="canManage" label="거래처 등록" icon="pi pi-plus" @click="openCreate" />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6">{{ error }}</Message>
        <Message v-else-if="!canManage" severity="info" :closable="false" class="mb-6">현재 계정은 거래처를 조회할 수 있습니다. 등록과 수정은 관리자에게 문의하세요.</Message>

        <section class="card mb-0" aria-labelledby="partner-list-title">
            <div class="flex flex-col gap-4 mb-5">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h2 id="partner-list-title" class="text-xl font-semibold">거래처 목록</h2>
                        <p class="mt-1 text-sm text-muted-color" aria-live="polite">조건에 맞는 거래처 {{ filteredPartners.length }}개</p>
                    </div>
                </div>
                <div class="grid grid-cols-12 gap-3" aria-label="거래처 필터">
                    <div class="col-span-12 lg:col-span-4">
                        <label for="partner-search" class="sr-only">거래처 검색</label>
                        <IconField class="w-full"><InputIcon class="pi pi-search" /><InputText id="partner-search" v-model="keyword" fluid placeholder="코드, 상호, 담당자, 연락처 검색" /></IconField>
                    </div>
                    <Select v-model="selectedCompanyId" :options="companyOptions" optionLabel="label" optionValue="value" aria-label="회사 필터" class="col-span-12 sm:col-span-4 lg:col-span-3" />
                    <Select v-model="roleFilter" :options="roleOptions" optionLabel="label" optionValue="value" aria-label="역할 필터" class="col-span-6 sm:col-span-4 lg:col-span-2" />
                    <Select v-model="statusFilter" :options="statusOptions" optionLabel="label" optionValue="value" aria-label="상태 필터" class="col-span-6 sm:col-span-4 lg:col-span-3" />
                </div>
            </div>

            <DataTable :value="filteredPartners" dataKey="id" :loading="loading || !contextReady" responsiveLayout="scroll" tableStyle="min-width: 68rem" :tableProps="{ 'aria-label': '거래처 목록' }" stripedRows scrollable>
                <template #empty>조건에 맞는 거래처가 없습니다.</template>
                <Column field="code" header="코드" sortable><template #body="{ data }"><span class="font-medium text-primary">{{ data.code }}</span></template></Column>
                <Column field="name" header="상호" sortable style="min-width: 12rem" />
                <Column header="회사" sortable sortField="companyId"><template #body="{ data }">{{ companyName(data.companyId) }}</template></Column>
                <Column header="역할"><template #body="{ data }"><Tag :value="roleLabel(data)" :severity="data.isCustomer && data.isVendor ? 'contrast' : data.isCustomer ? 'info' : 'warn'" /></template></Column>
                <Column header="사업자등록번호"><template #body="{ data }">{{ formatBusinessNumber(data.businessNumber) || '-' }}</template></Column>
                <Column field="contactName" header="담당자"><template #body="{ data }">{{ data.contactName || '-' }}</template></Column>
                <Column field="phone" header="연락처"><template #body="{ data }">{{ data.phone || '-' }}</template></Column>
                <Column field="isActive" header="상태" sortable><template #body="{ data }"><Tag :value="data.isActive ? '활성' : '비활성'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
                <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem"><template #body="{ data }"><div class="flex gap-1"><Button icon="pi pi-pencil" text rounded :aria-label="`${data.name} 거래처 수정`" :title="`${data.name} 거래처 수정`" @click="openEdit(data)" /><Button :icon="data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'" text rounded :severity="data.isActive ? 'danger' : 'secondary'" :aria-label="`${data.name} 거래처 ${data.isActive ? '비활성화' : '활성화'}`" :title="`${data.name} 거래처 ${data.isActive ? '비활성화' : '활성화'}`" @click="toggleActive(data)" /></div></template></Column>
            </DataTable>
        </section>

        <Dialog v-model:visible="dialogVisible" modal :header="dialogTitle" :style="{ width: '46rem' }" :breakpoints="{ '768px': '94vw' }">
            <form id="partner-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="save">
                <div class="col-span-12 sm:col-span-7"><label id="partner-companyId-label" for="partner-companyId" class="block mb-2 font-medium">소속 회사</label><Select inputId="partner-companyId" v-model="draft.companyId" :options="editableCompanyOptions" optionLabel="label" optionValue="value" fluid aria-labelledby="partner-companyId-label" :invalid="submitted && validation.errors.companyId" /><small v-if="submitted && validation.errors.companyId" class="text-red-700 dark:text-red-400" role="alert">회사를 선택해 주세요.</small></div>
                <div class="col-span-12 sm:col-span-5"><label for="partner-code" class="block mb-2 font-medium">거래처 코드</label><InputText id="partner-code" v-model="draft.code" fluid class="uppercase" placeholder="예: CUST-01" :invalid="submitted && validation.errors.code" /><small v-if="submitted && validation.errors.code" class="text-red-700 dark:text-red-400" role="alert">영문 대문자, 숫자, 하이픈으로 2~20자를 입력해 주세요.</small></div>
                <div class="col-span-12 sm:col-span-7"><label for="partner-name" class="block mb-2 font-medium">상호</label><InputText id="partner-name" v-model="draft.name" fluid :invalid="submitted && validation.errors.name" /><small v-if="submitted && validation.errors.name" class="text-red-700 dark:text-red-400" role="alert">상호를 입력해 주세요.</small></div>
                <div class="col-span-12 sm:col-span-5"><label for="partner-businessNumber" class="block mb-2 font-medium">사업자등록번호</label><InputText id="partner-businessNumber" v-model="draft.businessNumber" fluid inputmode="numeric" placeholder="000-00-00000" :invalid="submitted && validation.errors.businessNumber" /><small v-if="submitted && validation.errors.businessNumber" class="text-red-700 dark:text-red-400" role="alert">숫자 10자리를 입력해 주세요.</small></div>
                <fieldset class="col-span-12"><legend class="mb-2 font-medium">거래처 역할</legend><div class="flex flex-wrap gap-5"><label class="flex items-center gap-2 min-h-11"><Checkbox inputId="partner-isCustomer" v-model="draft.isCustomer" binary /><span>고객</span></label><label class="flex items-center gap-2 min-h-11"><Checkbox inputId="partner-isVendor" v-model="draft.isVendor" binary /><span>공급처</span></label></div><small v-if="submitted && validation.errors.roles" class="text-red-700 dark:text-red-400" role="alert">고객 또는 공급처를 하나 이상 선택해 주세요.</small></fieldset>
                <div class="col-span-12 sm:col-span-6"><label for="partner-representative" class="block mb-2 font-medium">대표자</label><InputText id="partner-representative" v-model="draft.representative" fluid /></div>
                <div class="col-span-12 sm:col-span-6"><label for="partner-contactName" class="block mb-2 font-medium">담당자</label><InputText id="partner-contactName" v-model="draft.contactName" fluid /></div>
                <div class="col-span-12 sm:col-span-6"><label for="partner-phone" class="block mb-2 font-medium">연락처</label><InputText id="partner-phone" v-model="draft.phone" fluid /></div>
                <div class="col-span-12 sm:col-span-6"><label for="partner-email" class="block mb-2 font-medium">이메일</label><InputText id="partner-email" v-model="draft.email" fluid type="email" :invalid="submitted && validation.errors.email" /><small v-if="submitted && validation.errors.email" class="text-red-700 dark:text-red-400" role="alert">올바른 이메일을 입력해 주세요.</small></div>
                <div class="col-span-12"><label for="partner-address" class="block mb-2 font-medium">주소</label><InputText id="partner-address" v-model="draft.address" fluid /></div>
                <div class="col-span-12 sm:col-span-6"><label for="partner-paymentTermsDays" class="block mb-2 font-medium">결제 조건(일)</label><InputNumber inputId="partner-paymentTermsDays" v-model="draft.paymentTermsDays" fluid :min="0" :useGrouping="false" :invalid="submitted && numericInvalid" /></div>
                <div class="col-span-12 sm:col-span-6"><label for="partner-creditLimit" class="block mb-2 font-medium">여신 한도</label><InputNumber inputId="partner-creditLimit" v-model="draft.creditLimit" fluid :min="0" suffix="원" /></div>
                <div v-if="mode === 'edit'" class="flex items-center gap-3 col-span-12 min-h-11"><ToggleSwitch inputId="partner-isActive" v-model="draft.isActive" /><label for="partner-isActive" class="font-medium">활성 거래처</label></div>
                <div class="flex justify-end gap-2 pt-2 col-span-12"><Button type="button" label="취소" severity="secondary" text @click="dialogVisible = false" /><Button type="submit" label="저장" icon="pi pi-check" :loading="saving" /></div>
            </form>
        </Dialog>
        <ConfirmDialog group="partners" />
    </div>
</template>
