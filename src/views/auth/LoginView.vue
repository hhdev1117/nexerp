<script setup>
import { nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { safeLocalRedirect } from '@/router/authGuard';
import { isValidLoginId } from '@/lib/auth/loginIdentity';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const loginId = ref('');
const password = ref('');
const fieldErrors = ref({ loginId: '', password: '' });
const submitError = ref('');
const submitting = ref(false);
const errorSummary = ref(null);
const AUTH_FAILURE_MESSAGE = '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NAVIGATION_FAILURE_MESSAGE = '화면을 이동하지 못했습니다. 다시 시도해 주세요.';

const validate = () => {
    const errors = { loginId: '', password: '' };
    if (!loginId.value) errors.loginId = '아이디를 입력해 주세요.';
    else if (!isValidLoginId(loginId.value)) errors.loginId = '아이디는 영문 소문자와 숫자 4~20자로 입력해 주세요.';
    if (!password.value) errors.password = '비밀번호를 입력해 주세요.';
    fieldErrors.value = errors;
    return errors;
};

const focus = async (id) => {
    await nextTick();
    document.getElementById(id)?.focus();
};

const focusErrorSummary = async () => {
    await nextTick();
    errorSummary.value?.focus();
};

const submit = async () => {
    submitError.value = '';
    const errors = validate();
    if (errors.loginId || errors.password) {
        await focus(errors.loginId ? 'login-id' : 'password');
        return;
    }

    submitting.value = true;
    try {
        try {
            await authStore.signIn(loginId.value, password.value);
        } catch {
            submitError.value = authStore.error.value || AUTH_FAILURE_MESSAGE;
            await focusErrorSummary();
            return;
        }

        try {
            await router.replace(safeLocalRedirect(route.query.redirect));
        } catch {
            submitError.value = NAVIGATION_FAILURE_MESSAGE;
            await focusErrorSummary();
        }
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <main class="auth-shell">
        <section class="auth-panel" aria-labelledby="login-title">
            <header class="auth-brand">
                <span class="auth-brand-mark" aria-hidden="true"><i class="pi pi-building"></i></span>
                <div>
                    <strong>NEXERP</strong>
                    <span>업무 관리 시스템</span>
                </div>
            </header>

            <div class="auth-heading">
                <h1 id="login-title">로그인</h1>
                <p>회사 계정으로 업무를 계속하세요.</p>
            </div>

            <form novalidate @submit.prevent="submit">
                <div v-if="submitError" ref="errorSummary" class="auth-alert" role="alert" aria-live="assertive" tabindex="-1">
                    <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                    <span>{{ submitError }}</span>
                </div>

                <div class="auth-field">
                    <label for="login-id">아이디</label>
                    <InputText id="login-id" v-model="loginId" type="text" inputmode="text" autocomplete="username" fluid :invalid="Boolean(fieldErrors.loginId)" :aria-invalid="Boolean(fieldErrors.loginId)" aria-describedby="login-id-error" />
                    <small id="login-id-error">{{ fieldErrors.loginId }}</small>
                </div>

                <div class="auth-field">
                    <label for="password">비밀번호</label>
                    <Password
                        inputId="password"
                        v-model="password"
                        autocomplete="current-password"
                        fluid
                        toggleMask
                        :feedback="false"
                        :invalid="Boolean(fieldErrors.password)"
                        :inputProps="{ autocomplete: 'current-password', 'aria-invalid': Boolean(fieldErrors.password), 'aria-describedby': 'password-error' }"
                    />
                    <small id="password-error">{{ fieldErrors.password }}</small>
                </div>

                <Button type="submit" label="로그인" icon="pi pi-sign-in" fluid :loading="submitting" :disabled="submitting" :aria-busy="submitting ? 'true' : 'false'" />
            </form>
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
    width: min(100%, 27rem);
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
    margin-bottom: 2rem;
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
.auth-brand span:last-child {
    color: var(--text-color-secondary, var(--p-surface-500));
    font-size: 0.8rem;
}
.auth-heading {
    margin-bottom: 1.5rem;
}
.auth-heading h1 {
    margin: 0 0 0.4rem;
    font-size: 1.75rem;
}
.auth-heading p {
    margin: 0;
    color: var(--text-color-secondary, var(--p-surface-500));
}
form {
    display: grid;
    gap: 1.25rem;
}
.auth-field {
    display: grid;
    gap: 0.5rem;
}
.auth-field label {
    font-weight: 600;
}
.auth-field small {
    min-height: 1.1rem;
    color: var(--p-red-600);
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
