// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { APPROVAL_STATUS } from '@/data/status';
import { resetErpRepository } from '@/repositories/erp';
import { useErpStore } from '@/stores/erp';
import Approvals from './Approvals.vue';

const toastAdd = vi.hoisted(() => vi.fn());
const authStore = {
    profile: ref({ role: 'user', is_active: true }),
    hasRole: (roles) => Boolean(authStore.profile.value?.is_active) && roles.includes(authStore.profile.value?.role)
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

const wrappers = [];

const mountApprovals = async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/approvals', component: { template: '<div />' } }] });
    await router.push('/approvals');
    await router.isReady();
    const wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [PrimeVue, ConfirmationService, router] } });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    resetErpRepository();
    await useErpStore().resetDemoState();
    toastAdd.mockReset();
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('approval decision access', () => {
    it('lets ordinary users read the inbox without any decision controls', async () => {
        authStore.profile.value = { role: 'user', is_active: true };
        const wrapper = await mountApprovals();

        expect(wrapper.text()).toContain('AP-260911-18');
        expect(wrapper.findAll('[data-approval-action="approve"]')).toHaveLength(0);
        expect(wrapper.findAll('button').filter((button) => button.text() === '반려' || button.text() === '승인')).toHaveLength(0);
        expect(wrapper.text()).toContain('결재자 처리 대기');
        expect(wrapper.text()).toContain('결재자 또는 관리자 계정에서만 처리할 수 있습니다');
    });

    it('hides decision controls from inactive approvers', async () => {
        authStore.profile.value = { role: 'approver', is_active: false };
        const wrapper = await mountApprovals();

        expect(wrapper.findAll('[data-approval-action="approve"]')).toHaveLength(0);
    });

    it.each(['approver', 'admin'])('lets the %s role approve a pending request through the store', async (role) => {
        authStore.profile.value = { role, is_active: true };
        const store = useErpStore();
        const wrapper = await mountApprovals();
        const before = store.pendingApprovalCount.value;

        expect(wrapper.text()).not.toContain('결재자 처리 대기');
        const approveButtons = wrapper.findAll('[data-approval-action="approve"]');
        expect(approveButtons).toHaveLength(before);

        await approveButtons[0].trigger('click');
        await flushPromises();

        expect(store.pendingApprovalCount.value).toBe(before - 1);
        expect(store.approvals.value.find((approval) => approval.id === 'AP-260911-18').status).toBe(APPROVAL_STATUS.APPROVED);
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '승인 완료' }));
        expect(wrapper.text()).toContain('승인 완료');
    });
});
