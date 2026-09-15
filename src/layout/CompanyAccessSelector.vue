<script setup>
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { useAuthStore } from '@/stores/auth';
import { erpMenu, flattenMenuRoutes } from '@/data/erp';
const runtime = useEnterpriseRuntimeStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const destinations = flattenMenuRoutes(erpMenu);
const companyOptions = computed(() => [{ value: '', label: '회사 선택', disabled: true }, ...(runtime.context.value?.companies || []).map((company) => ({ value: company.id, label: company.name }))]);
watch(
    () => [auth.user.value?.id, auth.profile.value?.is_active],
    ([id, active]) => {
        if (!id || !active) {
            runtime.reset();
            return;
        }
        if (runtime.identityId.value !== id) {
            runtime.reset();
            runtime.refresh(id);
        } else if (!runtime.context.value && !runtime.loading.value) runtime.refresh(id);
    },
    { immediate: true, flush: 'sync' }
);
async function navigateAllowed() {
    const context = runtime.context.value;
    if (!context) return;
    if (route.meta.fixedAccess && auth.profile.value?.role === 'admin') return;
    if (context.mode === 'legacy') {
        if (!route.meta.menuKey || route.meta.publishedAccessRequired) await router.replace('/');
        return;
    }
    if (runtime.canAccess(route.meta.menuKey)) return;
    const next = destinations.find((item) => runtime.canAccess(item.menuKey) && !context.hiddenMenuKeys?.includes(item.menuKey));
    await router.replace(next?.to || (auth.profile.value?.role === 'admin' ? '/settings/enterprise-access' : '/auth/access-denied'));
}
async function changeCompany(company) {
    if (company === runtime.context.value?.companyId) return;
    if (!window.confirm('회사를 변경하면 현재 화면의 저장하지 않은 입력이 닫힙니다. 변경하시겠습니까?')) return;
    await runtime.selectCompany(auth.user.value?.id, company);
    await navigateAllowed();
}
async function refresh() {
    if (route.meta.menuKey && !route.meta.fixedAccess && !window.confirm('권한을 다시 확인하면 현재 화면의 저장하지 않은 입력이 닫힙니다. 계속하시겠습니까?')) return;
    await runtime.refresh(auth.user.value?.id, runtime.context.value?.companyId || null);
    await navigateAllowed();
}
</script>
<template>
    <section v-if="auth.profile.value?.is_active" class="flex flex-wrap items-center gap-4 px-4 py-3 mb-4 text-sm border rounded-border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900" aria-label="현재 회사와 접근 권한">
        <div v-if="runtime.context.value?.companies.length" class="flex flex-col w-full gap-2 sm:flex-row sm:items-center sm:w-auto sm:gap-3">
            <label id="runtime-company-label" for="runtime-company" class="whitespace-nowrap">현재 회사</label>
            <Select
                inputId="runtime-company"
                :modelValue="runtime.context.value.companyId || ''"
                :options="companyOptions"
                optionLabel="label"
                optionValue="value"
                :optionDisabled="(option) => option.disabled"
                ariaLabelledby="runtime-company-label"
                :disabled="runtime.loading.value"
                size="small"
                class="w-56"
                @update:modelValue="changeCompany"
            />
        </div>
        <span v-if="runtime.context.value?.mode === 'active'">권한 버전 {{ runtime.context.value.revision }}</span>
        <span v-else-if="runtime.context.value?.mode === 'legacy'">기존 권한 사용 중</span>
        <span v-if="runtime.loading.value" role="status">회사 권한 확인 중…</span>
        <span v-if="runtime.error.value" role="alert">{{ runtime.error.value }}</span>
        <Button label="권한 다시 확인" icon="pi pi-refresh" size="small" severity="secondary" outlined class="ml-auto" :disabled="runtime.loading.value" @click="refresh" />
    </section>
</template>
