<script setup>
import { companyPayload, createCompanyDraft, createSiteDraft, formatBusinessNumber, sitePayload, siteTypeLabel, siteTypeOptions, validateCompanyDraft, validateSiteDraft } from '@/data/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { useAuthStore } from '@/stores/auth';
import { useMasterStore } from '@/stores/master';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';

const READ_ONLY_MESSAGE = '회사와 사업장 등록 및 수정은 관리자 계정에서만 할 수 있습니다. 현재 계정은 조회만 가능합니다.';

const authStore = useAuthStore();
const masterStore = useMasterStore();
const confirm = useConfirm();
const toast = useToast();
const { companies, sites, siteCountByCompany, loading, error, ensureLoaded, createCompany, updateCompany, createSite, updateSite } = masterStore;

const canManage = computed(() => authStore.hasRole(['admin']));
const keyword = ref('');
const selectedCompany = ref(null);
const saving = ref(false);

const companyDialog = ref(false);
const companyMode = ref('create');
const editingCompany = ref(null);
const companyDraft = ref(createCompanyDraft());
const companySubmitted = ref(false);
const companyErrors = computed(() => validateCompanyDraft(companyDraft.value));
const companyDialogTitle = computed(() => (companyMode.value === 'create' ? '회사 등록' : '회사 정보 수정'));

const siteDialog = ref(false);
const siteMode = ref('create');
const editingSite = ref(null);
const siteDraft = ref(createSiteDraft());
const siteSubmitted = ref(false);
const siteErrors = computed(() => validateSiteDraft(siteDraft.value));
const siteDialogTitle = computed(() => (siteMode.value === 'create' ? '사업장 등록' : '사업장 정보 수정'));

const filteredCompanies = computed(() => {
    const query = keyword.value.trim().toLocaleLowerCase('ko-KR');
    return companies.value.filter((company) => !query || [company.code, company.name, company.representative, formatBusinessNumber(company.businessNumber)].some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(query)));
});
const selectedCompanySites = computed(() => (selectedCompany.value ? sites.value.filter((site) => site.companyId === selectedCompany.value.id) : []));
const companyOptions = computed(() => companies.value.filter((company) => company.isActive || company.id === siteDraft.value.companyId).map((company) => ({ label: `${company.code} · ${company.name}`, value: company.id })));

ensureLoaded();

watch(
    companies,
    (rows) => {
        const currentId = selectedCompany.value?.id;
        selectedCompany.value = rows.find((company) => company.id === currentId) || rows[0] || null;
    },
    { immediate: true }
);

const notify = (severity, summary, detail) => toast.add({ severity, summary, detail, life: severity === 'success' ? 3000 : 3200 });
const failureDetail = (cause) => MASTER_ERROR_MESSAGES[cause?.code] || MASTER_ERROR_MESSAGES.master_save_failed;
const activeLabel = (row) => (row.isActive ? '활성' : '비활성');

async function focusFirstError(prefix, fields, errors) {
    await nextTick();
    const field = fields.find((name) => errors[name]);
    if (field) document.getElementById(`${prefix}-${field}`)?.focus();
}

function openCreateCompany() {
    companyMode.value = 'create';
    editingCompany.value = null;
    companyDraft.value = createCompanyDraft();
    companySubmitted.value = false;
    companyDialog.value = true;
}

function openEditCompany(company) {
    companyMode.value = 'edit';
    editingCompany.value = company;
    companyDraft.value = createCompanyDraft(company);
    companySubmitted.value = false;
    companyDialog.value = true;
}

async function saveCompany() {
    companySubmitted.value = true;
    if (Object.keys(companyErrors.value).length) {
        await focusFirstError('company', ['code', 'name', 'businessNumber'], companyErrors.value);
        return;
    }

    saving.value = true;
    try {
        const payload = companyPayload(companyDraft.value);
        const saved = companyMode.value === 'create' ? await createCompany(payload) : await updateCompany(editingCompany.value.id, payload);
        companyDialog.value = false;
        selectedCompany.value = saved;
        notify('success', companyMode.value === 'create' ? '회사 등록 완료' : '회사 수정 완료', `${saved.name} 회사 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '회사 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function toggleCompanyActive(company) {
    const activating = !company.isActive;
    confirm.require({
        group: 'master',
        message: activating ? `${company.name} 회사를 활성화하시겠습니까?` : `${company.name} 회사를 비활성화하시겠습니까? 소속 사업장도 함께 비활성화됩니다.`,
        header: activating ? '회사 활성화' : '회사 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            try {
                await updateCompany(company.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${company.name} 회사가 ${activating ? '활성화' : '비활성화'}되었습니다.`);
            } catch (cause) {
                notify('error', '상태 변경 실패', failureDetail(cause));
            }
        }
    });
}

function openCreateSite() {
    if (!selectedCompany.value) return;
    siteMode.value = 'create';
    editingSite.value = null;
    siteDraft.value = createSiteDraft(null, selectedCompany.value.id);
    siteSubmitted.value = false;
    siteDialog.value = true;
}

function openEditSite(site) {
    siteMode.value = 'edit';
    editingSite.value = site;
    siteDraft.value = createSiteDraft(site);
    siteSubmitted.value = false;
    siteDialog.value = true;
}

async function saveSite() {
    siteSubmitted.value = true;
    if (Object.keys(siteErrors.value).length) {
        await focusFirstError('site', ['companyId', 'code', 'name', 'siteType'], siteErrors.value);
        return;
    }

    saving.value = true;
    try {
        const payload = sitePayload(siteDraft.value);
        const saved = siteMode.value === 'create' ? await createSite(payload) : await updateSite(editingSite.value.id, payload);
        siteDialog.value = false;
        selectedCompany.value = companies.value.find((company) => company.id === saved.companyId) || selectedCompany.value;
        notify('success', siteMode.value === 'create' ? '사업장 등록 완료' : '사업장 수정 완료', `${saved.name} 사업장 정보가 저장되었습니다.`);
    } catch (cause) {
        notify('error', '사업장 저장 실패', failureDetail(cause));
    } finally {
        saving.value = false;
    }
}

function toggleSiteActive(site) {
    const activating = !site.isActive;
    confirm.require({
        group: 'master',
        message: `${site.name} 사업장을 ${activating ? '활성화' : '비활성화'}하시겠습니까?`,
        header: activating ? '사업장 활성화' : '사업장 비활성화',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: '취소', severity: 'secondary', outlined: true },
        acceptProps: { label: activating ? '활성화' : '비활성화', severity: activating ? 'primary' : 'danger' },
        accept: async () => {
            try {
                await updateSite(site.id, { isActive: activating });
                notify('success', '상태 변경 완료', `${site.name} 사업장이 ${activating ? '활성화' : '비활성화'}되었습니다.`);
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
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">회사 · 사업장</h1>
                <div class="mt-1 text-muted-color">여러 회사와 각 회사의 사업장을 등록하고 관리합니다. 삭제 대신 비활성화로 이력을 보존합니다.</div>
            </div>
            <div v-if="canManage" class="flex flex-wrap gap-2">
                <Button label="회사 등록" icon="pi pi-plus" @click="openCreateCompany" />
                <Button label="사업장 등록" icon="pi pi-plus" severity="secondary" outlined :disabled="!selectedCompany" @click="openCreateSite" />
            </div>
        </div>

        <Message v-if="error" severity="error" :closable="false" class="mb-6">{{ error }}</Message>
        <Message v-if="!canManage" severity="info" :closable="false" class="mb-6">{{ READ_ONLY_MESSAGE }}</Message>

        <div class="grid grid-cols-12 gap-6">
            <div class="col-span-12 xl:col-span-7">
                <div class="card h-full mb-0">
                    <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                        <h2 class="text-xl font-semibold">회사 목록</h2>
                        <IconField>
                            <InputIcon class="pi pi-search" />
                            <InputText v-model="keyword" placeholder="코드, 회사명, 대표자 검색" aria-label="회사 검색" class="w-full sm:w-72" />
                        </IconField>
                    </div>

                    <DataTable
                        v-model:selection="selectedCompany"
                        :value="filteredCompanies"
                        dataKey="id"
                        selectionMode="single"
                        :metaKeySelection="false"
                        :loading="loading"
                        responsiveLayout="scroll"
                        tableStyle="min-width: 46rem"
                        :tableProps="{ 'aria-label': '회사 목록' }"
                        stripedRows
                        scrollable
                    >
                        <template #empty>등록된 회사가 없습니다.</template>
                        <Column field="code" header="코드" sortable>
                            <template #body="slotProps"
                                ><span class="font-medium text-primary">{{ slotProps.data.code }}</span></template
                            >
                        </Column>
                        <Column field="name" header="회사명" sortable style="min-width: 11rem" />
                        <Column header="사업자등록번호">
                            <template #body="slotProps">{{ formatBusinessNumber(slotProps.data.businessNumber) || '-' }}</template>
                        </Column>
                        <Column field="representative" header="대표자" sortable />
                        <Column header="사업장">
                            <template #body="slotProps">{{ siteCountByCompany[slotProps.data.id] || 0 }}개</template>
                        </Column>
                        <Column field="isActive" header="상태" sortable>
                            <template #body="slotProps"><Tag :value="activeLabel(slotProps.data)" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                        </Column>
                        <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                            <template #body="slotProps">
                                <div class="flex gap-1">
                                    <Button icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.name} 회사 수정`" :title="`${slotProps.data.name} 회사 수정`" @click.stop="openEditCompany(slotProps.data)" />
                                    <Button
                                        :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                        text
                                        rounded
                                        :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                        :aria-label="`${slotProps.data.name} 회사 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                        :title="`${slotProps.data.name} 회사 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                        @click.stop="toggleCompanyActive(slotProps.data)"
                                    />
                                </div>
                            </template>
                        </Column>
                    </DataTable>
                </div>
            </div>

            <div class="col-span-12 xl:col-span-5">
                <div class="card h-full mb-0">
                    <div class="mb-4">
                        <h2 class="text-xl font-semibold">사업장</h2>
                        <div class="mt-1 text-sm text-muted-color">{{ selectedCompany ? `${selectedCompany.name} 소속 사업장입니다.` : '회사를 선택하면 소속 사업장이 표시됩니다.' }}</div>
                    </div>

                    <DataTable :value="selectedCompanySites" dataKey="id" :loading="loading" responsiveLayout="scroll" tableStyle="min-width: 34rem" :tableProps="{ 'aria-label': '사업장 목록' }" stripedRows scrollable>
                        <template #empty>{{ selectedCompany ? '등록된 사업장이 없습니다.' : '왼쪽 목록에서 회사를 선택하세요.' }}</template>
                        <Column field="code" header="코드" sortable>
                            <template #body="slotProps"
                                ><span class="font-medium text-primary">{{ slotProps.data.code }}</span></template
                            >
                        </Column>
                        <Column field="name" header="사업장명" sortable style="min-width: 9rem" />
                        <Column field="siteType" header="유형" sortable>
                            <template #body="slotProps">{{ siteTypeLabel(slotProps.data.siteType) }}</template>
                        </Column>
                        <Column field="isActive" header="상태" sortable>
                            <template #body="slotProps"><Tag :value="activeLabel(slotProps.data)" :severity="slotProps.data.isActive ? 'success' : 'secondary'" /></template>
                        </Column>
                        <Column v-if="canManage" header="작업" frozen alignFrozen="right" style="width: 7rem">
                            <template #body="slotProps">
                                <div class="flex gap-1">
                                    <Button icon="pi pi-pencil" text rounded :aria-label="`${slotProps.data.name} 사업장 수정`" :title="`${slotProps.data.name} 사업장 수정`" @click="openEditSite(slotProps.data)" />
                                    <Button
                                        :icon="slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'"
                                        text
                                        rounded
                                        :severity="slotProps.data.isActive ? 'danger' : 'secondary'"
                                        :aria-label="`${slotProps.data.name} 사업장 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                        :title="`${slotProps.data.name} 사업장 ${slotProps.data.isActive ? '비활성화' : '활성화'}`"
                                        @click="toggleSiteActive(slotProps.data)"
                                    />
                                </div>
                            </template>
                        </Column>
                    </DataTable>
                </div>
            </div>
        </div>

        <Dialog v-model:visible="companyDialog" modal :header="companyDialogTitle" :style="{ width: '34rem' }" :breakpoints="{ '640px': '92vw' }">
            <form id="company-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="saveCompany">
                <div class="col-span-12 sm:col-span-5">
                    <label for="company-code" class="block mb-2 font-medium">회사 코드</label>
                    <InputText id="company-code" v-model="companyDraft.code" fluid required :disabled="companyMode === 'edit'" autofocus aria-describedby="company-code-error" :invalid="companySubmitted && Boolean(companyErrors.code)" placeholder="예: NXM" class="uppercase" />
                    <small v-if="companySubmitted && companyErrors.code" id="company-code-error" class="text-red-700 dark:text-red-400" role="alert">{{ companyErrors.code }}</small>
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="company-name" class="block mb-2 font-medium">회사명</label>
                    <InputText id="company-name" v-model="companyDraft.name" fluid required aria-describedby="company-name-error" :invalid="companySubmitted && Boolean(companyErrors.name)" placeholder="회사명을 입력하세요" />
                    <small v-if="companySubmitted && companyErrors.name" id="company-name-error" class="text-red-700 dark:text-red-400" role="alert">{{ companyErrors.name }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="company-businessNumber" class="block mb-2 font-medium">사업자등록번호</label>
                    <InputText id="company-businessNumber" v-model="companyDraft.businessNumber" fluid inputmode="numeric" aria-describedby="company-businessNumber-error" :invalid="companySubmitted && Boolean(companyErrors.businessNumber)" placeholder="000-00-00000" />
                    <small v-if="companySubmitted && companyErrors.businessNumber" id="company-businessNumber-error" class="text-red-700 dark:text-red-400" role="alert">{{ companyErrors.businessNumber }}</small>
                </div>
                <div class="col-span-12 sm:col-span-6">
                    <label for="company-representative" class="block mb-2 font-medium">대표자</label>
                    <InputText id="company-representative" v-model="companyDraft.representative" fluid placeholder="대표자명을 입력하세요" />
                </div>
                <div class="col-span-12">
                    <label for="company-address" class="block mb-2 font-medium">주소</label>
                    <InputText id="company-address" v-model="companyDraft.address" fluid placeholder="본점 주소를 입력하세요" />
                </div>
                <div v-if="companyMode === 'edit'" class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="company-isActive" v-model="companyDraft.isActive" />
                    <label for="company-isActive" class="font-medium">활성 회사</label>
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text @click="companyDialog = false" />
                    <Button type="submit" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <Dialog v-model:visible="siteDialog" modal :header="siteDialogTitle" :style="{ width: '34rem' }" :breakpoints="{ '640px': '92vw' }">
            <form id="site-form" class="grid grid-cols-12 gap-4" novalidate @submit.prevent="saveSite">
                <div class="col-span-12">
                    <label id="site-companyId-label" for="site-companyId" class="block mb-2 font-medium">소속 회사</label>
                    <Select inputId="site-companyId" v-model="siteDraft.companyId" :options="companyOptions" optionLabel="label" optionValue="value" aria-labelledby="site-companyId-label" placeholder="회사를 선택하세요" fluid :invalid="siteSubmitted && Boolean(siteErrors.companyId)" />
                    <small v-if="siteSubmitted && siteErrors.companyId" id="site-companyId-error" class="text-red-700 dark:text-red-400" role="alert">{{ siteErrors.companyId }}</small>
                </div>
                <div class="col-span-12 sm:col-span-5">
                    <label for="site-code" class="block mb-2 font-medium">사업장 코드</label>
                    <InputText id="site-code" v-model="siteDraft.code" fluid required :disabled="siteMode === 'edit'" autofocus aria-describedby="site-code-error" :invalid="siteSubmitted && Boolean(siteErrors.code)" placeholder="예: ICN" class="uppercase" />
                    <small v-if="siteSubmitted && siteErrors.code" id="site-code-error" class="text-red-700 dark:text-red-400" role="alert">{{ siteErrors.code }}</small>
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="site-name" class="block mb-2 font-medium">사업장명</label>
                    <InputText id="site-name" v-model="siteDraft.name" fluid required aria-describedby="site-name-error" :invalid="siteSubmitted && Boolean(siteErrors.name)" placeholder="사업장명을 입력하세요" />
                    <small v-if="siteSubmitted && siteErrors.name" id="site-name-error" class="text-red-700 dark:text-red-400" role="alert">{{ siteErrors.name }}</small>
                </div>
                <div class="col-span-12 sm:col-span-5">
                    <label id="site-siteType-label" for="site-siteType" class="block mb-2 font-medium">유형</label>
                    <Select inputId="site-siteType" v-model="siteDraft.siteType" :options="siteTypeOptions" optionLabel="label" optionValue="value" aria-labelledby="site-siteType-label" fluid :invalid="siteSubmitted && Boolean(siteErrors.siteType)" />
                    <small v-if="siteSubmitted && siteErrors.siteType" id="site-siteType-error" class="text-red-700 dark:text-red-400" role="alert">{{ siteErrors.siteType }}</small>
                </div>
                <div class="col-span-12 sm:col-span-7">
                    <label for="site-address" class="block mb-2 font-medium">주소</label>
                    <InputText id="site-address" v-model="siteDraft.address" fluid placeholder="사업장 주소를 입력하세요" />
                </div>
                <div v-if="siteMode === 'edit'" class="flex items-center gap-3 col-span-12">
                    <ToggleSwitch inputId="site-isActive" v-model="siteDraft.isActive" />
                    <label for="site-isActive" class="font-medium">활성 사업장</label>
                </div>
                <div class="flex justify-end gap-2 pt-2 col-span-12">
                    <Button type="button" label="취소" severity="secondary" text @click="siteDialog = false" />
                    <Button type="submit" label="저장" icon="pi pi-check" :loading="saving" />
                </div>
            </form>
        </Dialog>

        <ConfirmDialog group="master" />
    </div>
</template>
