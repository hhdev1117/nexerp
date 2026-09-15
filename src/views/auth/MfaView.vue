<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { safeLocalRedirect } from '@/router/authGuard';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const code = ref('');
const selectedFactorId = ref('');
const manualKeyVisible = ref(false);
const submitted = ref(false);
const message = ref('');
const errorSummary = ref();

const enrollment = computed(() => authStore.mfaEnrollment.value);
const factors = computed(() => authStore.mfaFactors.value || []);
const factorOptions = computed(() => factors.value.map((factor) => ({ value: factor.id, label: factor.friendly_name || 'Google Authenticator' })));
const busy = computed(() => authStore.loading.value);
const mfaStatus = computed(() => authStore.mfaStatus.value);
const isEnroll = computed(() => mfaStatus.value === 'enroll');
const isChallenge = computed(() => mfaStatus.value === 'challenge');
const hasMfaError = computed(() => mfaStatus.value === 'error');
const cleanupPending = computed(() => Boolean(enrollment.value?.cleanupPending));
const validCode = computed(() => /^\d{6}$/.test(code.value));
const qrSource = computed(() => {
    const qrCode = enrollment.value?.qrCode || '';
    return qrCode.startsWith('<svg') ? `data:image/svg+xml,${encodeURIComponent(qrCode)}` : qrCode;
});

watch(
    factors,
    (nextFactors) => {
        if (!nextFactors.some((factor) => factor.id === selectedFactorId.value)) selectedFactorId.value = nextFactors[0]?.id || '';
    },
    { immediate: true }
);

const clearEntry = () => {
    code.value = '';
    submitted.value = false;
    manualKeyVisible.value = false;
};

const showMessage = async (nextMessage) => {
    message.value = nextMessage;
    await nextTick();
    errorSummary.value?.focus();
};

const returnToDestination = async (result) => {
    if (result?.status !== 'ready') {
        await showMessage('인증 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
        return;
    }
    await router.replace(safeLocalRedirect(route.query.redirect));
};

const refresh = async () => {
    message.value = '';
    clearEntry();
    try {
        const result = await authStore.refreshMfaState();
        if (result?.status === 'ready') await returnToDestination(result);
        else if (result?.status === 'enroll' && !enrollment.value) await authStore.beginTotpEnrollment();
    } catch {
        await showMessage('다중 인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
};

const submit = async () => {
    submitted.value = true;
    message.value = '';
    if (!validCode.value) {
        await showMessage('인증 앱의 6자리 숫자 코드를 입력해 주세요.');
        return;
    }

    try {
        let result = null;
        if (isEnroll.value) result = await authStore.verifyTotpEnrollment(code.value);
        else if (isChallenge.value && selectedFactorId.value) result = await authStore.verifyTotpChallenge(selectedFactorId.value, code.value);
        else {
            await showMessage('사용할 인증 앱을 선택한 후 다시 시도해 주세요.');
            return;
        }
        clearEntry();
        await returnToDestination(result);
    } catch {
        await showMessage('인증 코드를 확인하지 못했습니다. 다시 입력해 주세요.');
    }
};

const cancelEnrollment = async () => {
    message.value = '';
    try {
        const result = await authStore.cancelTotpEnrollment();
        clearEntry();
        if (result?.status === 'ready') await returnToDestination(result);
        else if (result?.status === 'enroll') await refresh();
        else await showMessage('인증 앱 등록 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
    } catch {
        await showMessage('인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
};

const retryCleanup = cancelEnrollment;

const signOut = async () => {
    message.value = '';
    try {
        await authStore.signOut();
        await router.replace({ name: 'login' });
    } catch {
        await showMessage('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
};

onMounted(refresh);
</script>

<template>
    <main class="auth-shell">
        <section class="grid gap-5 auth-panel" aria-labelledby="mfa-title">
            <header class="auth-brand">
                <span class="auth-brand-mark" aria-hidden="true"><i class="pi pi-shield"></i></span>
                <div>
                    <strong>NEXERP</strong>
                    <span>업무 관리 시스템</span>
                </div>
            </header>

            <div class="auth-heading !mb-0">
                <h1 id="mfa-title">2단계 인증</h1>
                <p v-if="cleanupPending">이전 인증 앱 등록을 정리한 후 다시 시도해 주세요.</p>
                <p v-else-if="isEnroll">Google Authenticator에 인증 앱을 등록해 주세요.</p>
                <p v-else-if="isChallenge">인증 앱의 6자리 코드를 입력해 주세요.</p>
                <p v-else-if="hasMfaError">인증 상태를 다시 확인해 주세요.</p>
                <p v-else>인증 상태를 확인하고 있습니다.</p>
            </div>

            <div v-if="message" ref="errorSummary" class="auth-alert" role="alert" aria-live="assertive" tabindex="-1">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                <span>{{ message }}</span>
            </div>

            <template v-if="cleanupPending">
                <Button label="등록 정리 다시 시도" icon="pi pi-refresh" fluid :loading="busy" :disabled="busy" @click="retryCleanup" />
            </template>

            <template v-else-if="hasMfaError">
                <Button label="다시 시도" icon="pi pi-refresh" fluid :loading="busy" :disabled="busy" @click="refresh" />
            </template>

            <template v-else>
                <div v-if="isEnroll && enrollment" class="grid gap-2">
                    <img :src="qrSource" alt="Google Authenticator 등록 QR 코드" class="w-48 h-48 justify-self-center" />
                    <Button :label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" :aria-label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" severity="secondary" text :disabled="busy" @click="manualKeyVisible = !manualKeyVisible" />
                    <code v-if="manualKeyVisible" class="p-3 break-all border rounded-border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">{{ enrollment.secret }}</code>
                </div>
                <p v-else-if="isEnroll">인증 앱 등록을 준비하고 있습니다.</p>

                <form v-if="isEnroll || isChallenge" novalidate @submit.prevent="submit">
                    <div v-if="isChallenge && factors.length > 1" class="auth-field">
                        <label id="mfa-factor-label" for="mfa-factor">인증 앱</label>
                        <Select inputId="mfa-factor" v-model="selectedFactorId" :options="factorOptions" optionLabel="label" optionValue="value" ariaLabelledby="mfa-factor-label" :disabled="busy" fluid />
                    </div>

                    <div class="auth-field">
                        <label for="mfa-code">인증 코드</label>
                        <InputText
                            id="mfa-code"
                            v-model="code"
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            pattern="[0-9]{6}"
                            maxlength="6"
                            fluid
                            :invalid="submitted && !validCode"
                            :aria-invalid="submitted && !validCode"
                            aria-describedby="mfa-code-error"
                            :disabled="busy"
                        />
                        <small id="mfa-code-error">{{ submitted && !validCode ? '6자리 숫자를 입력해 주세요.' : '' }}</small>
                    </div>

                    <Button type="submit" label="확인" icon="pi pi-check" fluid :loading="busy" :disabled="busy" :aria-busy="busy ? 'true' : 'false'" />
                </form>
            </template>

            <div class="flex flex-wrap gap-2">
                <Button v-if="!cleanupPending && !hasMfaError" label="상태 새로고침" icon="pi pi-refresh" severity="secondary" text :disabled="busy" @click="refresh" />
                <Button v-if="isEnroll && enrollment && !cleanupPending" label="등록 취소" icon="pi pi-times" severity="secondary" text :disabled="busy" @click="cancelEnrollment" />
                <Button label="로그아웃" icon="pi pi-sign-out" severity="secondary" text :disabled="busy" @click="signOut" />
            </div>
        </section>
    </main>
</template>

<style scoped>
form {
    display: grid;
    gap: 1.25rem;
}
</style>
