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
form {
    display: grid;
    gap: 1.25rem;
}
</style>
