// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppTopbar from './AppTopbar.vue';

const authStore = {
    user: ref({ id: 'user-1' }),
    profile: ref({ login_id: 'admin01', display_name: '', department: '', role: 'admin', is_active: true }),
    hasRole: vi.fn(() => true),
    changePassword: vi.fn(),
    signOut: vi.fn()
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }));

describe('application topbar identity', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
    });

    it('falls back to the public login ID without exposing an internal email address', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<main />' } }] });
        await router.push('/');
        await router.isReady();
        const wrapper = mount(AppTopbar, { global: { plugins: [PrimeVue, router] } });

        expect(wrapper.get('.erp-user-copy strong').text()).toBe('admin01');
        expect(wrapper.text()).not.toContain('@nexerp.internal');
        wrapper.unmount();
    });
});
