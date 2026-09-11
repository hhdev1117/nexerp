// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import LoginView from './LoginView.vue';
import SetupRequiredView from './SetupRequiredView.vue';
import AccessDeniedView from './AccessDeniedView.vue';

const authStore = {
    loading: ref(false),
    error: ref(null),
    signIn: vi.fn()
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));

const wrappers = [];

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

const mountLogin = async (url = '/login') => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<main>dashboard</main>' } },
            { path: '/login', component: LoginView },
            { path: '/approvals', component: { template: '<main>approvals</main>' } }
        ]
    });
    await router.push(url);
    await router.isReady();
    const wrapper = mount(LoginView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
    wrappers.push(wrapper);
    return { wrapper, router };
};

beforeEach(() => {
    authStore.loading.value = false;
    authStore.error.value = null;
    authStore.signIn.mockReset().mockResolvedValue({ user: { id: 'user-1' } });
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('login view', () => {
    it('shows required errors and focuses the first empty control', async () => {
        const { wrapper } = await mountLogin();

        await wrapper.get('form').trigger('submit');
        await nextTick();

        expect(wrapper.get('#email-error').text()).toContain('이메일을 입력해 주세요.');
        expect(wrapper.get('#password-error').text()).toContain('비밀번호를 입력해 주세요.');
        expect(document.activeElement).toBe(wrapper.get('#email').element);
        expect(authStore.signIn).not.toHaveBeenCalled();
    });

    it('rejects an invalid email and focuses the email control', async () => {
        const { wrapper } = await mountLogin();
        await wrapper.get('#email').setValue('not-an-email');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await nextTick();

        expect(wrapper.get('#email-error').text()).toContain('올바른 이메일 주소를 입력해 주세요.');
        expect(document.activeElement).toBe(wrapper.get('#email').element);
    });

    it('disables the submit action while sign-in is pending', async () => {
        const pending = deferred();
        authStore.signIn.mockReturnValueOnce(pending.promise);
        const { wrapper } = await mountLogin();
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await nextTick();

        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('button[type="submit"]').attributes('aria-busy')).toBe('true');
        pending.resolve({ user: { id: 'user-1' } });
        await flushPromises();
    });

    it('signs in and restores a safe local redirect with router replacement', async () => {
        const { wrapper, router } = await mountLogin('/login?redirect=/approvals');
        const replace = vi.spyOn(router, 'replace');
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(authStore.signIn).toHaveBeenCalledWith('user@nexerp.test', 'password');
        expect(replace).toHaveBeenCalledWith('/approvals');
    });

    it('rejects protocol-relative redirects and returns to the dashboard', async () => {
        const { wrapper, router } = await mountLogin('/login?redirect=//evil.example/path');
        const replace = vi.spyOn(router, 'replace');
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(replace).toHaveBeenCalledWith('/');
    });

    it('presents a sign-in error accessibly and focuses its summary', async () => {
        authStore.error.value = '이메일 또는 비밀번호가 올바르지 않습니다.';
        authStore.signIn.mockRejectedValueOnce(new Error('이메일 또는 비밀번호가 올바르지 않습니다.'));
        const { wrapper } = await mountLogin();
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('wrong');

        await wrapper.get('form').trigger('submit');
        await flushPromises();

        const summary = wrapper.get('[role="alert"]');
        expect(summary.text()).toContain('이메일 또는 비밀번호가 올바르지 않습니다.');
        expect(document.activeElement).toBe(summary.element);
    });

    it('does not render raw sign-in exception details', async () => {
        authStore.signIn.mockRejectedValueOnce(new Error('sentinel-secret-auth-detail'));
        const { wrapper } = await mountLogin();
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toContain('로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(wrapper.text()).not.toContain('sentinel-secret-auth-detail');
    });

    it('does not render raw router exception details after authentication', async () => {
        const { wrapper, router } = await mountLogin();
        vi.spyOn(router, 'replace').mockRejectedValueOnce(new Error('sentinel-secret-router-detail'));
        await wrapper.get('#email').setValue('user@nexerp.test');
        await wrapper.get('#password').setValue('password');

        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toContain('화면을 이동하지 못했습니다. 다시 시도해 주세요.');
        expect(wrapper.text()).not.toContain('sentinel-secret-router-detail');
    });

    it('uses email and current-password autocomplete without optional account links', async () => {
        const { wrapper } = await mountLogin();

        expect(wrapper.get('#email').attributes('autocomplete')).toBe('email');
        expect(wrapper.get('#password').attributes('autocomplete')).toBe('current-password');
        expect(wrapper.text()).not.toContain('회원가입');
        expect(wrapper.text()).not.toContain('비밀번호 찾기');
        expect(wrapper.text()).not.toContain('자동 로그인');
    });
});

describe('supporting auth views', () => {
    it('names only the required public connection variables and offers reload', async () => {
        const reload = vi.fn();
        const wrapper = mount(SetupRequiredView, { attachTo: document.body, props: { reloadPage: reload }, global: { plugins: [PrimeVue] } });
        wrappers.push(wrapper);

        expect(wrapper.text()).toContain('VITE_SUPABASE_URL');
        expect(wrapper.text()).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
        expect(wrapper.text()).not.toMatch(/service.?role|secret/i);
        await wrapper.get('[aria-label="연결 설정 다시 확인"]').trigger('click');
        expect(reload).toHaveBeenCalledOnce();
    });

    it('explains denied access and links back to the dashboard', () => {
        const wrapper = mount(AccessDeniedView, {
            global: {
                plugins: [PrimeVue],
                stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } }
            }
        });
        wrappers.push(wrapper);

        expect(wrapper.text()).toContain('권한');
        expect(wrapper.get('a').attributes('href')).toBe('/');
    });
});
