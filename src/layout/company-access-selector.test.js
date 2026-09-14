// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import CompanyAccessSelector from './CompanyAccessSelector.vue';
const runtime = { context: ref({ mode: 'active', companyId: 'a', companies: [{ id: 'a', name: 'A회사' }], menuKeys: ['dashboard'], revision: 1 }), identityId: ref('u'), loading: ref(false), error: ref(null), refresh: vi.fn(), reset: vi.fn(), selectCompany: vi.fn(), canAccess: () => true };
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => runtime }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: ref({ id: 'u' }), profile: ref({ role: 'user', is_active: true }) }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }), useRoute: () => ({ meta: { menuKey: 'dashboard' }, fullPath: '/' }) }));
describe('company permission selector', () => {
    it('shows server-authorized company and active revision', async () => {
        const wrapper = mount(CompanyAccessSelector);
        await flushPromises();
        expect(wrapper.get('select').element.value).toBe('a');
        expect(wrapper.text()).toContain('권한 버전 1');
    });
});
