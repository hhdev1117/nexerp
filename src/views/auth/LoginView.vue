<script setup>
import { nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { safeLocalRedirect } from '@/router/authGuard';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const fieldErrors = ref({ email: '', password: '' });
const submitError = ref('');
const submitting = ref(false);
const errorSummary = ref(null);
const AUTH_FAILURE_MESSAGE = '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NAVIGATION_FAILURE_MESSAGE = '화면을 이동하지 못했습니다. 다시 시도해 주세요.';

const validate = () => {
    const errors = { email: '', password: '' };
    if (!email.value.trim()) errors.email = '이메일을 입력해 주세요.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) errors.email = '올바른 이메일 주소를 입력해 주세요.';
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
    if (errors.email || errors.password) {
        await focus(errors.email ? 'email' : 'password');
        return;
    }

    submitting.value = true;
    try {
        try {
            await authStore.signIn(email.value.trim(), password.value);
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
                    <label for="email">이메일</label>
                    <InputText id="email" v-model="email" type="email" autocomplete="email" fluid :invalid="Boolean(fieldErrors.email)" :aria-invalid="Boolean(fieldErrors.email)" aria-describedby="email-error" />
                    <small id="email-error">{{ fieldErrors.email }}</small>
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
