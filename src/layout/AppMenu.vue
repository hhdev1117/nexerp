<script setup>
import { erpMenu, filterMenuByAccess } from '@/data/erp';
import { useAccessStore } from '@/stores/access';
import { useAuthStore } from '@/stores/auth';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
import { computed } from 'vue';
import AppMenuItem from './AppMenuItem.vue';

const authStore = useAuthStore();
const accessStore = useAccessStore();
const runtime = useEnterpriseRuntimeStore();
const recoveryKeys = new Set(['settings.accounts', 'settings.menu-permissions', 'settings.enterprise-access', 'settings.infrastructure-usage', 'settings.hr-modules']);
const model = computed(() =>
    filterMenuByAccess(erpMenu, (menuKey) => {
        if (recoveryKeys.has(menuKey)) return authStore.profile.value?.is_active && authStore.profile.value?.role === 'admin';
        if (runtime.context.value?.mode === 'active') return runtime.canAccess(menuKey) && !runtime.context.value.hiddenMenuKeys?.includes(menuKey);
        if (runtime.context.value?.mode !== 'legacy' || menuKey === 'hr.core') return false;
        return accessStore.canAccess(menuKey, authStore.profile.value?.role);
    })
);
</script>

<template>
    <ul class="layout-menu">
        <template v-for="(item, i) in model" :key="item">
            <app-menu-item v-if="!item.separator" :item="item" :index="i"></app-menu-item>
            <li v-if="item.separator" class="menu-separator"></li>
        </template>
    </ul>
</template>

<style lang="scss" scoped></style>
