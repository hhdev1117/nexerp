// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';
import CompanyAccessSelector from './CompanyAccessSelector.vue';
const runtime = {
    context: ref({ mode: 'active', companyId: 'a', companies: [{ id: 'a', name: 'A회사' }], menuKeys: ['dashboard'], revision: 1 }),
    identityId: ref('u'),
    loading: ref(false),
    error: ref(null),
    refresh: vi.fn(),
    reset: vi.fn(),
    selectCompany: vi.fn(),
    canAccess: () => true
};
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => runtime }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: ref({ id: 'u' }), profile: ref({ role: 'user', is_active: true }) }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }), useRoute: () => ({ meta: { menuKey: 'dashboard' }, fullPath: '/' }) }));
describe('company permission selector', () => {
    it('shows server-authorized company and active revision', async () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
        });
        const wrapper = mount(CompanyAccessSelector, { global: { plugins: [PrimeVue] } });
        await flushPromises();
        const companySelect = wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === 'runtime-company');
        expect(companySelect.props('modelValue')).toBe('a');
        expect(wrapper.text()).toContain('권한 버전 1');
    });
});
