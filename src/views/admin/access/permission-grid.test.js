// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { expect, it } from 'vitest';
import AccessPermissionGrid from './AccessPermissionGrid.vue';

it('retains independent scopes when another scope is removed', async () => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    const wrapper = mount(AccessPermissionGrid, {
        global: { plugins: [PrimeVue] },
        props: {
            resources: [{ key: 'dashboard', label: '대시보드' }],
            modelValue: [
                { resource: 'dashboard', action: 'read', scope: 'self' },
                { resource: 'dashboard', action: 'read', scope: 'assigned' }
            ]
        }
    });
    const self = wrapper.findAllComponents({ name: 'Checkbox' }).find((candidate) => candidate.props('inputId') === 'dashboard-self');
    expect(self).toBeTruthy();
    self.vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:modelValue')[0][0]).toEqual([{ resource: 'dashboard', action: 'read', scope: 'assigned' }]);
});
