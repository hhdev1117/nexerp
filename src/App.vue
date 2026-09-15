<script setup>
import { useLayout } from '@/layout/composables/layout';
import PwaUpdatePrompt from '@/pwa/PwaUpdatePrompt.vue';
import { useAuthStore } from '@/stores/auth';
import { watch } from 'vue';

const authStore = useAuthStore();
const { applyLayoutPreferences, resetLayoutPreferences } = useLayout();
let observedUserId;
let appliedLayoutUserId = null;

watch(
    [() => authStore.user.value?.id || null, () => authStore.profile.value?.id || null, () => authStore.profile.value?.is_active === true],
    ([userId, profileId, isActive]) => {
        const matchingActiveProfile = Boolean(userId && userId === profileId && isActive);
        const identityChanged = userId !== observedUserId;

        if (identityChanged) {
            observedUserId = userId;
            appliedLayoutUserId = null;
            if (!matchingActiveProfile) resetLayoutPreferences();
        }

        if (!userId || !profileId) return;

        if (!matchingActiveProfile) {
            resetLayoutPreferences();
            appliedLayoutUserId = null;
            return;
        }

        if (appliedLayoutUserId === userId) return;
        applyLayoutPreferences(authStore.profile.value.ui_preferences);
        appliedLayoutUserId = userId;
    },
    { immediate: true }
);
</script>

<template>
    <router-view />
    <PwaUpdatePrompt />
</template>

<style scoped></style>
