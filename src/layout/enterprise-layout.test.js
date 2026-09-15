// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { expect, it, vi } from 'vitest';
import AppLayout from './AppLayout.vue';
const runtime = { context: ref({ mode: 'active', companyId: 'a' }), loading: ref(false), canAccess: () => true };
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => runtime }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: ref({ id: 'admin' }), profile: ref({ role: 'admin', is_active: true }) }) }));
it('preserves a fixed administration draft while runtime context refreshes', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<input id="draft" />' }, meta: { fixedAccess: true } }] });
    await router.push('/');
    await router.isReady();
    const wrapper = mount(AppLayout, { global: { plugins: [router], stubs: { AppTopbar: true, AppSidebar: true, AppFooter: true, CompanyAccessSelector: true, Toast: true } } });
    await wrapper.get('#draft').setValue('저장 전 편집');
    const input = wrapper.get('#draft').element;
    runtime.context.value = null;
    runtime.loading.value = true;
    await flushPromises();
    expect(wrapper.get('#draft').element).toBe(input);
    runtime.context.value = { mode: 'active', companyId: 'a' };
    runtime.loading.value = false;
    await flushPromises();
    expect(wrapper.get('#draft').element.value).toBe('저장 전 편집');
    wrapper.unmount();
});
