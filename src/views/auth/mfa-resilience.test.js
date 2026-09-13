// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createAuthGuard } from '@/router/authGuard';
import SecuritySettings from '@/views/admin/SecuritySettings.vue';
import MfaView from './MfaView.vue';

const confirmRequire = vi.hoisted(() => vi.fn());
const authStore = {
    configured: ref(true),
    loading: ref(false),
    error: ref(null),
    user: ref({ id: 'user-a' }),
    profile: ref({ role: 'user', is_active: true }),
    mfaStatus: ref('challenge'),
    mfaSatisfied: ref(false),
    mfaEnrollment: ref(null),
    mfaFactors: ref([{ id: 'factor-a', friendly_name: 'Authenticator A' }]),
    initialize: vi.fn(),
    refreshMfaState: vi.fn(),
    beginTotpEnrollment: vi.fn(),
    verifyTotpEnrollment: vi.fn(),
    verifyTotpChallenge: vi.fn(),
    cancelTotpEnrollment: vi.fn(),
    unenrollTotp: vi.fn(),
    signOut: vi.fn(),
    hasRole: vi.fn(() => true)
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: confirmRequire }) }));

const wrappers = [];

const makeRouter = async (url = '/auth/mfa?redirect=/approvals') => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/auth/mfa', name: 'mfa', component: MfaView },
            { path: '/approvals', name: 'approvals', component: { template: '<main>approvals</main>' } },
            { path: '/', name: 'dashboard', component: { template: '<main>dashboard</main>' } },
            { path: '/auth/login', name: 'login', component: { template: '<main>login</main>' } }
        ]
    });
    await router.push(url);
    await router.isReady();
    return router;
};

beforeEach(() => {
    authStore.configured.value = true;
    authStore.loading.value = false;
    authStore.error.value = null;
    authStore.user.value = { id: 'user-a' };
    authStore.profile.value = { role: 'user', is_active: true };
    authStore.mfaStatus.value = 'challenge';
    authStore.mfaSatisfied.value = false;
    authStore.mfaEnrollment.value = null;
    authStore.mfaFactors.value = [{ id: 'factor-a', friendly_name: 'Authenticator A' }];
    authStore.initialize.mockReset().mockResolvedValue(undefined);
    authStore.refreshMfaState.mockReset().mockResolvedValue({ status: 'challenge', factors: authStore.mfaFactors.value });
    authStore.beginTotpEnrollment.mockReset();
    authStore.verifyTotpEnrollment.mockReset();
    authStore.verifyTotpChallenge.mockReset();
    authStore.cancelTotpEnrollment.mockReset();
    authStore.unenrollTotp.mockReset();
    authStore.signOut.mockReset().mockResolvedValue(undefined);
    authStore.hasRole.mockReset().mockReturnValue(true);
    confirmRequire.mockReset();
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('MFA resilience', () => {
    it('does not follow a stale refresh result after the store changes to another ready identity', async () => {
        authStore.refreshMfaState.mockImplementation(async () => {
            authStore.user.value = { id: 'user-b' };
            authStore.profile.value = { role: 'user', is_active: true };
            authStore.mfaStatus.value = 'ready';
            authStore.mfaSatisfied.value = true;
            return null;
        });
        const router = await makeRouter();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/auth/mfa?redirect=/approvals');
    });

    it('does not follow a stale verification result after another identity becomes ready', async () => {
        const router = await makeRouter();
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();
        authStore.verifyTotpChallenge.mockImplementation(async () => {
            authStore.user.value = { id: 'user-b' };
            authStore.mfaStatus.value = 'ready';
            authStore.mfaSatisfied.value = true;
            return null;
        });

        await wrapper.get('#mfa-code').setValue('123456');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/auth/mfa?redirect=/approvals');
    });

    it('shows an enrollment-cleanup retry instead of enrollment secrets or code controls', async () => {
        authStore.mfaStatus.value = 'enroll';
        authStore.mfaEnrollment.value = { factorId: 'cleanup-factor', cleanupPending: true };
        authStore.refreshMfaState.mockResolvedValue({ status: 'enroll' });
        const router = await makeRouter('/auth/mfa');
        const wrapper = mount(MfaView, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
        wrappers.push(wrapper);
        await flushPromises();

        expect(wrapper.text()).toContain('등록 정리');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('form').exists()).toBe(false);
        const retry = wrapper.findAll('button').find((button) => button.text().includes('등록 정리 다시 시도'));
        await retry.trigger('click');
        expect(authStore.cancelTotpEnrollment).toHaveBeenCalledOnce();
    });

    it('keeps security cleanup and MFA-error states retry-only', async () => {
        authStore.mfaStatus.value = 'enroll';
        authStore.mfaEnrollment.value = { factorId: 'cleanup-factor', cleanupPending: true };
        authStore.refreshMfaState.mockResolvedValue({ status: 'enroll' });
        const cleanupWrapper = mount(SecuritySettings, { attachTo: document.body, global: { plugins: [PrimeVue], stubs: { ConfirmDialog: true } } });
        wrappers.push(cleanupWrapper);
        await flushPromises();

        expect(cleanupWrapper.find('img').exists()).toBe(false);
        expect(cleanupWrapper.find('#backup-mfa-code').exists()).toBe(false);
        expect(cleanupWrapper.text()).not.toContain('백업 인증 앱 추가');
        const cleanupRetry = cleanupWrapper.findAll('button').find((button) => button.text().includes('등록 정리 다시 시도'));
        await cleanupRetry.trigger('click');
        expect(authStore.cancelTotpEnrollment).toHaveBeenCalledOnce();

        authStore.mfaStatus.value = 'error';
        authStore.mfaEnrollment.value = null;
        const errorWrapper = mount(SecuritySettings, { attachTo: document.body, global: { plugins: [PrimeVue], stubs: { ConfirmDialog: true } } });
        wrappers.push(errorWrapper);
        await flushPromises();

        expect(errorWrapper.text()).toContain('다시 시도');
        expect(errorWrapper.find('.factor-list').exists()).toBe(false);
        expect(errorWrapper.text()).not.toContain('백업 인증 앱 추가');
    });

    it('preserves guest-only destinations and fails closed when guard refresh changes identity', async () => {
        const guard = createAuthGuard(authStore);
        authStore.mfaStatus.value = 'challenge';
        authStore.refreshMfaState.mockResolvedValue({ status: 'challenge' });
        await expect(guard({ name: 'login', fullPath: '/auth/login?redirect=/approvals', query: { redirect: '/approvals' }, meta: { public: true, guestOnly: true } })).resolves.toEqual({ name: 'mfa', query: { redirect: '/approvals' } });

        authStore.mfaStatus.value = 'ready';
        authStore.refreshMfaState.mockResolvedValue({ status: 'ready' });
        await expect(guard({ name: 'login', fullPath: '/auth/login?redirect=/approvals', query: { redirect: '/approvals' }, meta: { public: true, guestOnly: true } })).resolves.toBe('/approvals');

        authStore.user.value = { id: 'user-a' };
        authStore.mfaStatus.value = 'challenge';
        authStore.refreshMfaState.mockImplementation(async () => {
            authStore.user.value = { id: 'user-b' };
            authStore.mfaStatus.value = 'ready';
            return null;
        });
        await expect(guard({ name: 'login', fullPath: '/auth/login?redirect=/approvals', query: { redirect: '/approvals' }, meta: { public: true, guestOnly: true } })).resolves.toEqual({ name: 'mfa', query: { redirect: '/' } });

        authStore.user.value = { id: 'user-a' };
        authStore.mfaStatus.value = 'challenge';
        await expect(guard({ name: 'approvals', fullPath: '/approvals', meta: {} })).resolves.toEqual({ name: 'mfa', query: { redirect: '/' } });
    });
});
