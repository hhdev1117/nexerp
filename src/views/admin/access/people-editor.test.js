// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import AccessPeopleEditor from './AccessPeopleEditor.vue';

it('does not link unfinished exceptions to an unselected account', () => {
    const wrapper = mount(AccessPeopleEditor, { props: { resources: [{ key: 'dashboard', label: '대시보드' }], modelValue: {
        levels: [{ id: 1, name: '직원' }], members: [{ id: '', name: '', grade: '', position: '', level: null, organizationId: '', siteId: '', active: true, from: null, to: null }],
        roles: [], overrides: [{ actorId: '', resource: 'dashboard', action: 'read', scope: 'self', effect: 'deny', from: null, to: null }]
    } } });
    expect(wrapper.get('.access-person select').element.disabled).toBe(false);
});
