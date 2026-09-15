// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import EnterpriseAccess from './EnterpriseAccess.vue';

const repo = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/repositories/access/enterpriseRuntimeRepository', () => ({
    createEnterpriseRuntimeRepository: () => ({ listAdminCompanies: async () => [{ id: 'company-a', name: '테스트 회사' }], listAdminSites: async () => [], loadPublication: async () => ({ active: false, revision: 0, draftRevision: null }) })
}));
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => ({ context: ref(null), refresh: vi.fn() }) }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: ref({ id: 'admin' }) }) }));
vi.mock('@/services/adminApi', () => ({ useAdminApi: () => ({ listAccounts: async () => [{ id: 'actor-a', displayName: '김대리', email: 'test@gmail.com', isActive: true }] }) }));
vi.mock('@/repositories/access/enterpriseAccessRepository', () => ({ createEnterpriseAccessRepository: () => repo }));
vi.mock('@/stores/master', () => ({ useMasterStore: () => ({ activeCompanies: ref([{ id: 'company-a', name: '테스트 회사' }]), ensureLoaded: async () => {}, error: ref(null) }) }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

describe('enterprise access management', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
        });
        // PrimeVue TabList observes its scroll container, which jsdom does not implement.
        window.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        repo.load.mockReset().mockResolvedValue({ policy: null, revision: 0 });
        repo.save.mockReset();
    });
    const selectCompany = async (wrapper, value) => {
        const select = wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === 'access-company');
        expect(select, 'Select#access-company').toBeTruthy();
        select.vm.$emit('update:modelValue', value);
        await flushPromises();
    };
    it('requires explicit company selection and exposes four workflows', async () => {
        const wrapper = mount(EnterpriseAccess, { global: { plugins: [PrimeVue] } });
        expect(repo.load).not.toHaveBeenCalled();
        await flushPromises();
        await selectCompany(wrapper, 'company-a');
        expect(repo.load).toHaveBeenCalledWith('company-a');
        expect(wrapper.findAll('[role="tab"]')).toHaveLength(4);
        expect(wrapper.text()).toContain('레벨 5');
        expect(wrapper.text()).toContain('기존 업무 권한');
    });
    it('keeps load failure distinct from a new policy and offers retry', async () => {
        repo.load.mockRejectedValue(new Error('불러오기 실패'));
        const wrapper = mount(EnterpriseAccess, { global: { plugins: [PrimeVue] } });
        await flushPromises();
        await selectCompany(wrapper, 'company-a');
        expect(wrapper.get('[role="alert"]').text()).toContain('불러오기 실패');
        expect(wrapper.find('[data-testid="policy-editor"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('다시 불러오기');
    });
    it('saves a reviewed policy with a reason and the loaded revision', async () => {
        repo.save.mockImplementation(async (_company, policy) => ({ policy: JSON.parse(JSON.stringify(policy)), revision: 1 }));
        const wrapper = mount(EnterpriseAccess, { global: { plugins: [PrimeVue] } });
        await flushPromises();
        await selectCompany(wrapper, 'company-a');
        await wrapper.get('#level-name').setValue('일반 구성원');
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '변경 내용 확인')
            .trigger('click');
        await flushPromises();
        expect(repo.save).not.toHaveBeenCalled();
        await wrapper.get('#change-reason').setValue('회사 권한 체계 초기 등록');
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '검토한 설정 저장')
            .trigger('click');
        await flushPromises();
        expect(repo.save).toHaveBeenCalledWith('company-a', expect.any(Object), 0, '회사 권한 체계 초기 등록');
        expect(wrapper.text()).toContain('버전 1');
    });
});
