<script setup>
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { useAuthStore } from '@/stores/auth';
import { erpMenu, flattenMenuRoutes } from '@/data/erp';
const runtime = useEnterpriseRuntimeStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const destinations = flattenMenuRoutes(erpMenu);
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
async function changeCompany(event) {
    const company = event.target.value;
    if (company === runtime.context.value?.companyId) return;
    if (!window.confirm('회사를 변경하면 현재 화면의 저장하지 않은 입력이 닫힙니다. 변경하시겠습니까?')) {
        event.target.value = runtime.context.value?.companyId || '';
        return;
    }
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
    <section v-if="auth.profile.value?.is_active" class="company-access-bar" aria-label="현재 회사와 접근 권한">
        <label v-if="runtime.context.value?.companies.length" for="runtime-company"
            >현재 회사<select id="runtime-company" :value="runtime.context.value.companyId || ''" :disabled="runtime.loading.value" @change="changeCompany">
                <option value="" disabled>회사 선택</option>
                <option v-for="company in runtime.context.value.companies" :key="company.id" :value="company.id">{{ company.name }}</option>
            </select></label
        >
        <span v-if="runtime.context.value?.mode === 'active'">권한 버전 {{ runtime.context.value.revision }}</span>
        <span v-else-if="runtime.context.value?.mode === 'legacy'">기존 권한 사용 중</span>
        <span v-if="runtime.loading.value" role="status">회사 권한 확인 중…</span>
        <span v-if="runtime.error.value" role="alert">{{ runtime.error.value }}</span>
        <button type="button" :disabled="runtime.loading.value" @click="refresh">권한 다시 확인</button>
    </section>
</template>
<style scoped>
.company-access-bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    font-size: 0.9rem;
}
label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 100%;
}
select,
button {
    font: inherit;
    color: var(--text-color);
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    min-height: 44px;
    max-width: 100%;
}
button {
    cursor: pointer;
    margin-left: auto;
}
button:disabled {
    opacity: 0.6;
    cursor: wait;
}
:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: 2px;
}
@media (max-width: 575px) {
    label {
        flex-direction: column;
        align-items: stretch;
        width: 100%;
    }
    button {
        margin-left: 0;
    }
}
</style>
