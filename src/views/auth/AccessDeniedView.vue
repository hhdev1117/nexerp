<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import CompanyAccessSelector from '@/layout/CompanyAccessSelector.vue';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const retrying = ref(false);
const signingOut = ref(false);
const actionError = ref('');
const SIGN_OUT_FAILURE_MESSAGE = '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NAVIGATION_FAILURE_MESSAGE = '화면을 이동하지 못했습니다. 다시 시도해 주세요.';

const localRedirect = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');
const recoverableProfileFailure = computed(() => Boolean(authStore.user.value && authStore.profileLoadFailed.value));
const requiresSignOut = computed(() => Boolean(authStore.user.value && !authStore.profile.value?.is_active));
const displayedError = computed(() => actionError.value || (recoverableProfileFailure.value ? authStore.error.value : ''));

const retryProfile = async () => {
    retrying.value = true;
    actionError.value = '';
    try {
        await authStore.retryProfile();
        if (authStore.profile.value?.is_active) {
            try {
                await router.replace(localRedirect(route.query.redirect));
            } catch {
                actionError.value = NAVIGATION_FAILURE_MESSAGE;
            }
        }
    } catch {
        // The store retains the normalized profile error for this recoverable state.
    } finally {
        retrying.value = false;
    }
};

const signOut = async () => {
    signingOut.value = true;
    actionError.value = '';
    try {
        await authStore.signOut();
    } catch {
        actionError.value = SIGN_OUT_FAILURE_MESSAGE;
        signingOut.value = false;
        return;
    }

    try {
        await router.replace({ name: 'login' });
    } catch {
        actionError.value = NAVIGATION_FAILURE_MESSAGE;
    } finally {
        signingOut.value = false;
    }
};
</script>

<template>
    <main class="auth-shell">
        <section class="auth-panel auth-panel-wide auth-panel-centered" aria-labelledby="access-title">
            <CompanyAccessSelector v-if="authStore.profile.value?.is_active" />
            <span class="auth-status-icon auth-status-icon-danger" aria-hidden="true"><i :class="recoverableProfileFailure ? 'pi pi-refresh' : 'pi pi-lock'"></i></span>
            <p class="mb-6 font-bold">NEXERP</p>
            <h1 id="access-title" class="mt-0 mb-3 text-2xl font-semibold">{{ recoverableProfileFailure ? '권한 정보를 불러오지 못했습니다' : '접근 권한이 없습니다' }}</h1>
            <p v-if="recoverableProfileFailure" class="mt-0 mb-6 leading-relaxed text-muted-color">연결이 복구되면 권한 정보를 다시 불러올 수 있습니다.</p>
            <p v-else class="mt-0 mb-6 leading-relaxed text-muted-color">로그인한 계정에는 이 업무를 볼 권한이 없습니다. 필요한 경우 관리자에게 문의해 주세요.</p>
            <div v-if="displayedError" class="mb-5 auth-alert" role="alert" aria-live="assertive">{{ displayedError }}</div>
            <div class="auth-actions">
                <Button v-if="recoverableProfileFailure" label="다시 시도" icon="pi pi-refresh" aria-label="권한 정보 다시 불러오기" :loading="retrying" :disabled="retrying" :aria-busy="retrying ? 'true' : 'false'" @click="retryProfile" />
                <Button
                    v-if="requiresSignOut"
                    label="로그아웃"
                    icon="pi pi-sign-out"
                    severity="secondary"
                    aria-label="로그아웃하고 로그인 화면으로 이동"
                    :loading="signingOut"
                    :disabled="signingOut"
                    :aria-busy="signingOut ? 'true' : 'false'"
                    @click="signOut"
                />
                <Button v-if="!requiresSignOut" as="router-link" to="/" label="대시보드로 돌아가기" icon="pi pi-arrow-left" />
            </div>
        </section>
    </main>
</template>
