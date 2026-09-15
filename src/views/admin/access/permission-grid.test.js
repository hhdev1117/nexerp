// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import AccessPermissionGrid from './AccessPermissionGrid.vue';

it('retains independent scopes when another scope is removed', async () => {
    const wrapper = mount(AccessPermissionGrid, {
        props: {
            resources: [{ key: 'dashboard', label: '대시보드' }],
            modelValue: [
                { resource: 'dashboard', action: 'read', scope: 'self' },
                { resource: 'dashboard', action: 'read', scope: 'assigned' }
            ]
        }
    });
    const self = wrapper.find('input[data-scope="self"]');
    expect(self.exists()).toBe(true);
    await self.setValue(false);
    expect(wrapper.emitted('update:modelValue')[0][0]).toEqual([{ resource: 'dashboard', action: 'read', scope: 'assigned' }]);
});
