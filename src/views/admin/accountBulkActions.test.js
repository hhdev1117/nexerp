// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AccountManagement from './AccountManagement.vue';

const harness = vi.hoisted(() => ({}));
vi.mock('@/services/adminApi', () => ({ useAdminApi: () => harness.api }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: ref({ id: 'admin-id' }) }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: harness.toastAdd }) }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: harness.confirmRequire }) }));

const account = (id, displayName, isActive) => ({ id, displayName, email: `${id}@nexerp.test`, department: '영업', role: 'user', isActive });

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    harness.toastAdd = vi.fn();
    // The confirmation dialog is a thin wrapper here; running accept keeps the test focused on the bulk behaviour.
    harness.confirmRequire = vi.fn((options) => options.accept());
    harness.api = {
        listAccounts: vi.fn().mockResolvedValue([account('a1', '김서준', true), account('a2', '박지민', true), account('admin-id', '관리자', true)]),
        updateAccountStatus: vi.fn((id, isActive) => Promise.resolve({ ...account(id, id === 'a1' ? '김서준' : '박지민', isActive) }))
    };
});

const mountScreen = async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/accounts', component: { template: '<div />' } }] });
    await router.replace('/settings/accounts');
    await router.isReady();
    const wrapper = mount(AccountManagement, { global: { plugins: [PrimeVue, router] } });
    await flushPromises();
    return wrapper;
};

const selectAccounts = async (wrapper, rows) => {
    wrapper.findComponent({ name: 'DataTable' }).vm.$emit('update:selection', rows);
    await flushPromises();
};

it('locks every selected account and reports the result once', async () => {
    const wrapper = await mountScreen();
    await selectAccounts(wrapper, [account('a1', '김서준', true), account('a2', '박지민', true)]);

    const lock = wrapper.findAll('button').find((button) => button.text().includes('선택 잠금'));
    expect(lock).toBeTruthy();
    await lock.trigger('click');
    await flushPromises();

    expect(harness.api.updateAccountStatus).toHaveBeenCalledTimes(2);
    expect(harness.api.updateAccountStatus).toHaveBeenCalledWith('a1', false);
    expect(harness.api.updateAccountStatus).toHaveBeenCalledWith('a2', false);
    expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: expect.stringContaining('2개 계정') }));
});

it('keeps the failed accounts selected and explains the partial failure', async () => {
    harness.api.updateAccountStatus = vi.fn((id, isActive) => (id === 'a2' ? Promise.reject(new Error('locked')) : Promise.resolve({ ...account(id, '김서준', isActive) })));
    const wrapper = await mountScreen();
    await selectAccounts(wrapper, [account('a1', '김서준', true), account('a2', '박지민', true)]);

    await wrapper
        .findAll('button')
        .find((button) => button.text().includes('선택 잠금'))
        .trigger('click');
    await flushPromises();

    expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: expect.stringContaining('박지민') }));
    expect(wrapper.text()).toContain('선택한');
});

it('never includes the signed-in account in a bulk change', async () => {
    const wrapper = await mountScreen();
    await selectAccounts(wrapper, [account('admin-id', '관리자', true)]);

    expect(wrapper.findAll('button').some((button) => button.text().includes('선택 잠금'))).toBe(false);
});
