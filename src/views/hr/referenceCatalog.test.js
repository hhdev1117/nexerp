// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { it, expect, vi } from 'vitest';
import ReferenceCatalog from './ReferenceCatalog.vue';
const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/hrReference', () => ({ useHrReferenceStore: () => mocks.store }));
it('requires reason, locks existing codes and offers only active department parents', async () => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.store = {
        catalog: ref([
            { id: 'a', companyId: 'company', kind: 'department', code: 'A', name: '운영', isActive: true, revision: 2 },
            { id: 'b', kind: 'department', code: 'B', name: '폐지', isActive: false, revision: 1 }
        ]),
        canManage: ref(true),
        loading: ref(false),
        saving: ref(false),
        error: ref(null),
        save: vi.fn().mockResolvedValue(true)
    };
    const w = mount(ReferenceCatalog, {
        global: {
            plugins: [PrimeVue],
            stubs: { Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{label}}</button>' }, Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/></section>' } }
        }
    });
    await w.get('[data-testid="reference-edit"]').trigger('click');
    expect(w.get('#reference-code').attributes('disabled')).toBeDefined();
    const parentSelect = w.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === 'reference-parent');
    expect(
        parentSelect
            .props('options')
            .map((option) => option.label)
            .join(' ')
    ).not.toContain('폐지');
    await w.get('[data-testid="reference-form"]').trigger('submit');
    expect(mocks.store.save).not.toHaveBeenCalled();
    await w.get('#reference-reason').setValue('명칭 정리');
    await w.get('[data-testid="reference-form"]').trigger('submit');
    await flushPromises();
    expect(mocks.store.save).toHaveBeenCalledWith({ id: 'a', kind: 'department', code: 'A', name: '운영', parentCode: null, isActive: true }, 2, '명칭 정리');
});
