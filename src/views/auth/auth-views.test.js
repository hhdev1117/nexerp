// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import LoginView from './LoginView.vue';
import SetupRequiredView from './SetupRequiredView.vue';
import AccessDeniedView from './AccessDeniedView.vue';
import MfaView from './MfaView.vue';

const authStore = {
    loading: ref(false),
    error: ref(null),
    user: ref(null),
    profile: ref(null),
    profileLoadFailed: ref(false),
    signIn: vi.fn(),
    retryProfile: vi.fn(),
    signOut: vi.fn(),
    mfaStatus: ref('enroll'),
    mfaSatisfied: ref(false),
    mfaEnrollment: ref(null),
    mfaFactors: ref([]),
    refreshMfaState: vi.fn(),
    beginTotpEnrollment: vi.fn(),
    verifyTotpEnrollment: vi.fn(),
    verifyTotpChallenge: vi.fn(),
    cancelTotpEnrollment: vi.fn()
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

const mountAccessDenied = async (url = '/access-denied') => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'dashboard', component: { template: '<main>dashboard</main>' } },
            { path: '/login', name: 'login', component: { template: '<main>login</main>' } },
            { path: '/access-denied', name: 'access-denied', component: AccessDeniedView },
            { path: '/approvals', name: 'approvals', component: { template: '<main>approvals</main>' } }
        ]
    });
    await router.push(url);
    await router.isReady();
    const wrapper = mount(AccessDeniedView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
    wrappers.push(wrapper);
    return { wrapper, router };
};

beforeEach(() => {
    authStore.loading.value = false;
    authStore.error.value = null;
    authStore.user.value = null;
    authStore.profile.value = null;
    authStore.profileLoadFailed.value = false;
    authStore.signIn.mockReset().mockResolvedValue({ user: { id: 'user-1' } });
    authStore.retryProfile.mockReset().mockResolvedValue(undefined);
    authStore.signOut.mockReset().mockResolvedValue(undefined);
    authStore.mfaStatus.value = 'enroll';
    authStore.mfaSatisfied.value = false;
    authStore.mfaEnrollment.value = null;
    authStore.mfaFactors.value = [];
    authStore.refreshMfaState.mockReset().mockResolvedValue({ status: 'enroll' });
    authStore.beginTotpEnrollment.mockReset().mockImplementation(async () => {
        const nextEnrollment = { factorId: 'factor-1', qrCode: '<svg/>', secret: 'TEST-SECRET', uri: 'otpauth://secret' };
        authStore.mfaEnrollment.value = nextEnrollment;
        return nextEnrollment;
    });
    authStore.verifyTotpEnrollment.mockReset().mockResolvedValue({ status: 'ready' });
    authStore.verifyTotpChallenge.mockReset();
    authStore.cancelTotpEnrollment.mockReset().mockResolvedValue(undefined);
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
    it('keeps enrollment secrets hidden until explicitly revealed and validates a six-digit code', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/mfa', name: 'mfa', component: MfaView }, { path: '/', component: { template: '<main />' } }] });
        await router.push('/auth/mfa');
        await router.isReady();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        expect(wrapper.text()).not.toContain('TEST-SECRET');
        expect(wrapper.get('img').attributes('src')).toContain('data:image/svg+xml');
        expect(wrapper.get('[aria-label="수동 키 표시"]').exists()).toBe(true);
        await wrapper.get('[aria-label="수동 키 표시"]').trigger('click');
        expect(wrapper.text()).toContain('TEST-SECRET');
        await wrapper.get('button').trigger('click');
        expect(wrapper.text()).not.toContain('TEST-SECRET');
        await wrapper.get('form').trigger('submit');
        expect(authStore.verifyTotpEnrollment).not.toHaveBeenCalled();
        expect(wrapper.get('[role="alert"]').text()).toContain('6자리');
    });

    it('cancels an incomplete enrollment and returns a verified session only after it is ready', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/auth/mfa', name: 'mfa', component: MfaView },
                { path: '/approvals', name: 'approvals', component: { template: '<main />' } },
                { path: '/', component: { template: '<main />' } }
            ]
        });
        await router.push('/auth/mfa?redirect=/approvals');
        await router.isReady();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        const cancelButton = wrapper.findAll('button').find((button) => button.text().includes('등록 취소'));
        await cancelButton.trigger('click');
        expect(authStore.cancelTotpEnrollment).toHaveBeenCalledOnce();

        authStore.mfaStatus.value = 'challenge';
        authStore.mfaFactors.value = [{ id: 'factor-primary', friendly_name: 'Primary authenticator' }];
        authStore.mfaEnrollment.value = null;
        authStore.verifyTotpChallenge.mockImplementation(async () => {
            authStore.mfaStatus.value = 'ready';
            authStore.mfaSatisfied.value = true;
            return { status: 'ready' };
        });
        await wrapper.get('#mfa-code').setValue('123456');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/approvals');
    });

    it('does not navigate after verification when authoritative MFA state is not ready', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/mfa', name: 'mfa', component: MfaView }, { path: '/approvals', component: { template: '<main />' } }, { path: '/', component: { template: '<main />' } }] });
        await router.push('/auth/mfa?redirect=/approvals');
        await router.isReady();
        authStore.mfaStatus.value = 'challenge';
        authStore.mfaFactors.value = [{ id: 'factor-primary', friendly_name: 'Primary authenticator' }];
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        await wrapper.get('#mfa-code').setValue('123456');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/auth/mfa?redirect=/approvals');
        expect(wrapper.get('[role="alert"]').text()).toContain('인증 상태를 확인하지 못했습니다');
    });

    it('keeps the MFA screen stable when sign-out fails', async () => {
        authStore.signOut.mockRejectedValueOnce(new Error('network'));
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/mfa', name: 'mfa', component: MfaView }, { path: '/', component: { template: '<main />' } }] });
        await router.push('/auth/mfa');
        await router.isReady();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        const signOutButton = wrapper.findAll('button').find((button) => button.text().includes('로그아웃'));
        await signOutButton.trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/auth/mfa');
        expect(wrapper.get('[role="alert"]').text()).toContain('로그아웃하지 못했습니다');
        expect(wrapper.text()).not.toContain('network');
    });

    it('shows only a retry action for a failed MFA lookup', async () => {
        authStore.mfaStatus.value = 'error';
        authStore.refreshMfaState.mockRejectedValueOnce(new Error('network'));
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/mfa', name: 'mfa', component: MfaView }, { path: '/', component: { template: '<main />' } }] });
        await router.push('/auth/mfa');
        await router.isReady();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        expect(wrapper.text()).toContain('다시 시도');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('network');
    });

    it('lets the user select among multiple verified authenticators for a challenge', async () => {
        authStore.mfaStatus.value = 'challenge';
        authStore.mfaFactors.value = [
            { id: 'factor-primary', friendly_name: 'Primary authenticator' },
            { id: 'factor-backup', friendly_name: 'Backup authenticator' }
        ];
        authStore.refreshMfaState.mockResolvedValue({ status: 'challenge' });
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/mfa', name: 'mfa', component: MfaView }, { path: '/', component: { template: '<main />' } }] });
        await router.push('/auth/mfa');
        await router.isReady();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        expect(wrapper.get('#mfa-factor').text()).toContain('Backup authenticator');
        await wrapper.get('#mfa-factor').setValue('factor-backup');
        await wrapper.get('#mfa-code').setValue('123456');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(authStore.verifyTotpChallenge).toHaveBeenCalledWith('factor-backup', '123456');
    });
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

    it('explains ordinary role denial and links back to the dashboard', async () => {
        authStore.user.value = { id: 'user-1' };
        authStore.profile.value = { role: 'user', is_active: true };
        const { wrapper } = await mountAccessDenied();

        expect(wrapper.text()).toContain('권한');
        expect(wrapper.get('a').attributes('href')).toBe('/');
    });

    it('shows a recoverable profile error and keeps retry pending until safe redirect restoration', async () => {
        const pending = deferred();
        authStore.user.value = { id: 'user-1' };
        authStore.profileLoadFailed.value = true;
        authStore.error.value = '네트워크 연결을 확인한 후 다시 시도해 주세요.';
        authStore.retryProfile.mockReturnValueOnce(pending.promise);
        const { wrapper, router } = await mountAccessDenied('/access-denied?redirect=/approvals');

        expect(wrapper.get('[role="alert"]').text()).toContain('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        const retry = wrapper.get('[aria-label="권한 정보 다시 불러오기"]');
        await retry.trigger('click');
        await nextTick();

        expect(retry.attributes('disabled')).toBeDefined();
        expect(retry.attributes('aria-busy')).toBe('true');
        authStore.profileLoadFailed.value = false;
        authStore.profile.value = { role: 'approver', is_active: true };
        pending.resolve();
        await flushPromises();

        expect(authStore.retryProfile).toHaveBeenCalledOnce();
        expect(router.currentRoute.value.fullPath).toBe('/approvals');
    });

    it('rejects a protocol-relative recovery redirect', async () => {
        authStore.user.value = { id: 'user-1' };
        authStore.profileLoadFailed.value = true;
        authStore.error.value = '계정 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.';
        authStore.retryProfile.mockImplementationOnce(async () => {
            authStore.profileLoadFailed.value = false;
            authStore.profile.value = { role: 'approver', is_active: true };
        });
        const { wrapper, router } = await mountAccessDenied('/access-denied?redirect=//evil.example/path');

        await wrapper.get('[aria-label="권한 정보 다시 불러오기"]').trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/');
    });

    it.each([
        ['missing', null],
        ['inactive', { role: 'user', is_active: false }]
    ])('lets an authenticated user with a %s profile sign out to login', async (_state, profile) => {
        const pending = deferred();
        authStore.user.value = { id: 'user-1' };
        authStore.profile.value = profile;
        authStore.signOut.mockReturnValueOnce(pending.promise);
        const { wrapper, router } = await mountAccessDenied();

        const signOut = wrapper.get('[aria-label="로그아웃하고 로그인 화면으로 이동"]');
        await signOut.trigger('click');
        await nextTick();

        expect(signOut.attributes('disabled')).toBeDefined();
        expect(signOut.attributes('aria-busy')).toBe('true');
        expect(router.currentRoute.value.name).toBe('access-denied');

        pending.resolve();
        await flushPromises();

        expect(authStore.signOut).toHaveBeenCalledOnce();
        expect(router.currentRoute.value.name).toBe('login');
    });

    it('shows a fixed sign-out failure without raw exception details', async () => {
        authStore.user.value = { id: 'user-1' };
        authStore.profile.value = null;
        authStore.signOut.mockRejectedValueOnce(new Error('sentinel-secret-sign-out-detail'));
        const { wrapper } = await mountAccessDenied();

        await wrapper.get('[aria-label="로그아웃하고 로그인 화면으로 이동"]').trigger('click');
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toContain('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(wrapper.text()).not.toContain('sentinel-secret-sign-out-detail');
    });
});
