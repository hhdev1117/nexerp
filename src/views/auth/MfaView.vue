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
const busy = computed(() => authStore.loading.value);
const mfaStatus = computed(() => authStore.mfaStatus.value);
const isEnroll = computed(() => mfaStatus.value === 'enroll');
const isChallenge = computed(() => mfaStatus.value === 'challenge');
const hasMfaError = computed(() => mfaStatus.value === 'error');
const isMfaReady = computed(() => authStore.mfaSatisfied?.value || mfaStatus.value === 'ready');
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

const returnToDestination = async () => {
    if (!isMfaReady.value) {
        await showMessage('인증 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
        return;
    }
    await router.replace(safeLocalRedirect(route.query.redirect));
};

const refresh = async () => {
    message.value = '';
    clearEntry();
    try {
        await authStore.refreshMfaState();
        if (isEnroll.value && !enrollment.value) await authStore.beginTotpEnrollment();
        if (isMfaReady.value) await returnToDestination();
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
        if (isEnroll.value) await authStore.verifyTotpEnrollment(code.value);
        else if (isChallenge.value && selectedFactorId.value) await authStore.verifyTotpChallenge(selectedFactorId.value, code.value);
        else {
            await showMessage('사용할 인증 앱을 선택한 후 다시 시도해 주세요.');
            return;
        }
        clearEntry();
        await returnToDestination();
    } catch {
        await showMessage('인증 코드를 확인하지 못했습니다. 다시 입력해 주세요.');
    }
};

const cancelEnrollment = async () => {
    message.value = '';
    try {
        await authStore.cancelTotpEnrollment();
        clearEntry();
        await refresh();
    } catch {
        await showMessage('인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
};

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
        <section class="auth-panel" aria-labelledby="mfa-title">
            <header class="auth-brand">
                <span class="auth-brand-mark" aria-hidden="true"><i class="pi pi-shield"></i></span>
                <div>
                    <strong>NEXERP</strong>
                    <span>업무 관리 시스템</span>
                </div>
            </header>

            <div class="auth-heading">
                <h1 id="mfa-title">2단계 인증</h1>
                <p v-if="isEnroll">Google Authenticator에 인증 앱을 등록해 주세요.</p>
                <p v-else-if="isChallenge">인증 앱의 6자리 코드를 입력해 주세요.</p>
                <p v-else-if="hasMfaError">인증 상태를 다시 확인해 주세요.</p>
                <p v-else>인증 상태를 확인하고 있습니다.</p>
            </div>

            <div v-if="message" ref="errorSummary" class="auth-alert" role="alert" aria-live="assertive" tabindex="-1">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                <span>{{ message }}</span>
            </div>

            <template v-if="hasMfaError">
                <Button label="다시 시도" icon="pi pi-refresh" fluid :loading="busy" :disabled="busy" @click="refresh" />
            </template>

            <template v-else>
                <div v-if="isEnroll && enrollment" class="mfa-enrollment">
                    <img :src="qrSource" alt="Google Authenticator 등록 QR 코드" class="mfa-qr" />
                    <Button :label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" :aria-label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" severity="secondary" text :disabled="busy" @click="manualKeyVisible = !manualKeyVisible" />
                    <code v-if="manualKeyVisible" class="manual-key">{{ enrollment.secret }}</code>
                </div>
                <p v-else-if="isEnroll">인증 앱 등록을 준비하고 있습니다.</p>

                <form v-if="isEnroll || isChallenge" novalidate @submit.prevent="submit">
                    <div v-if="isChallenge && factors.length > 1" class="auth-field">
                        <label for="mfa-factor">인증 앱</label>
                        <select id="mfa-factor" v-model="selectedFactorId" :disabled="busy">
                            <option v-for="factor in factors" :key="factor.id" :value="factor.id">{{ factor.friendly_name || 'Google Authenticator' }}</option>
                        </select>
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

            <div class="mfa-actions">
                <Button v-if="!hasMfaError" label="상태 새로고침" icon="pi pi-refresh" severity="secondary" text :disabled="busy" @click="refresh" />
                <Button v-if="isEnroll && enrollment" label="등록 취소" icon="pi pi-times" severity="secondary" text :disabled="busy" @click="cancelEnrollment" />
                <Button label="로그아웃" icon="pi pi-sign-out" severity="secondary" text :disabled="busy" @click="signOut" />
            </div>
        </section>
    </main>
</template>

<style scoped>
.auth-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--surface-ground, var(--p-surface-100));
    color: var(--text-color, var(--p-surface-900));
}
.auth-panel {
    width: min(100%, 30rem);
    display: grid;
    gap: 1.25rem;
    padding: 2rem;
    border: 1px solid var(--surface-border, var(--p-surface-200));
    border-top: 4px solid var(--primary-color, var(--p-primary-700));
    border-radius: 8px;
    background: var(--surface-card, var(--p-surface-0));
    box-shadow: 0 12px 28px color-mix(in srgb, var(--p-surface-900) 9%, transparent);
}
.auth-brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}
.auth-brand-mark {
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--primary-color, var(--p-primary-700));
    color: var(--primary-color-text, #fff);
}
.auth-brand div {
    display: grid;
    gap: 0.1rem;
}
.auth-brand strong {
    font-size: 1.05rem;
}
.auth-brand span:last-child,
.auth-heading p {
    color: var(--text-color-secondary, var(--p-surface-500));
    font-size: 0.8rem;
}
.auth-heading h1 {
    margin: 0 0 0.4rem;
    font-size: 1.75rem;
}
.auth-heading p {
    margin: 0;
    font-size: 1rem;
}
.auth-field,
form,
.mfa-enrollment {
    display: grid;
    gap: 0.5rem;
}
form {
    gap: 1.25rem;
}
.auth-field label {
    font-weight: 600;
}
.auth-field small {
    min-height: 1.1rem;
    color: var(--p-red-600);
}
.auth-field select {
    min-height: 2.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    background: var(--surface-card);
    color: inherit;
}
.mfa-qr {
    width: 12rem;
    height: 12rem;
    justify-self: center;
}
.manual-key {
    padding: 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    overflow-wrap: anywhere;
    background: var(--surface-ground);
}
.auth-alert {
    display: flex;
    gap: 0.6rem;
    padding: 0.75rem;
    border: 1px solid var(--p-red-300);
    border-radius: 6px;
    background: var(--p-red-50);
    color: var(--p-red-700);
}
.auth-alert:focus {
    outline: 2px solid var(--primary-color, var(--p-primary-700));
    outline-offset: 2px;
}
.mfa-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
@media (max-width: 575px) {
    .auth-shell {
        align-items: stretch;
        padding: 0;
        background: var(--surface-card, var(--p-surface-0));
    }
    .auth-panel {
        width: 100%;
        min-height: 100vh;
        padding: 2rem 1.25rem;
        border: 0;
        border-top: 4px solid var(--primary-color, var(--p-primary-700));
        border-radius: 0;
        box-shadow: none;
    }
}
</style>
