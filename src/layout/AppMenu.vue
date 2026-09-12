<script setup>
import { erpMenu, filterMenuByAccess } from '@/data/erp';
import { useAccessStore } from '@/stores/access';
import { useAuthStore } from '@/stores/auth';
import { computed } from 'vue';
import AppMenuItem from './AppMenuItem.vue';

const authStore = useAuthStore();
const accessStore = useAccessStore();
const model = computed(() => filterMenuByAccess(erpMenu, (menuKey) => accessStore.canAccess(menuKey, authStore.profile.value?.role)));
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
