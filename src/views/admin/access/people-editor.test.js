// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { expect, it } from 'vitest';
import AccessPeopleEditor from './AccessPeopleEditor.vue';

it('does not link unfinished exceptions to an unselected account', () => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    const wrapper = mount(AccessPeopleEditor, {
        global: { plugins: [PrimeVue] },
        props: {
            resources: [{ key: 'dashboard', label: '대시보드' }],
            modelValue: {
                levels: [{ id: 1, name: '직원' }],
                members: [{ id: '', name: '', grade: '', position: '', level: null, organizationId: '', siteId: '', active: true, from: null, to: null }],
                roles: [],
                overrides: [{ actorId: '', resource: 'dashboard', action: 'read', scope: 'self', effect: 'deny', from: null, to: null }]
            }
        }
    });
    const accountSelect = wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === 'member-account-0');
    expect(accountSelect.props('disabled')).toBe(false);
});
