// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { beforeEach, it, expect, vi } from 'vitest';
import HRModules from './HRModules.vue';
const m = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => m.auth }));
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => m.runtime }));
vi.mock('@/repositories/access/enterpriseRuntimeRepository', () => ({ createEnterpriseRuntimeRepository: () => m.catalog }));
vi.mock('@/repositories/hr/hrModuleRepository', () => ({ createHrModuleRepository: () => m.repo }));
const settings = (companyId = 'a') => ({
    companyId,
    modules: [
        { key: 'hr.core', label: '인사 기본', available: true, state: 'enabled', menuVisible: true, revision: 0, pendingActions: 2, dependents: [] },
        { key: 'hr.payroll', label: '급여', available: false, state: 'disabled', menuVisible: false, revision: 0, pendingActions: 0, dependents: [] }
    ]
});
beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    m.auth = { user: ref({ id: 'u' }), profile: ref({ is_active: true, role: 'admin' }), role: ref('admin') };
    m.runtime = { context: ref({ companyId: 'a' }), refresh: vi.fn().mockResolvedValue(true) };
    m.catalog = {
        listAdminCompanies: vi.fn().mockResolvedValue([
            { id: 'a', name: '회사 A' },
            { id: 'b', name: '회사 B' }
        ])
    };
    m.repo = { loadSettings: vi.fn().mockImplementation(async (id) => settings(id)), saveSettings: vi.fn().mockResolvedValue(settings()) };
});
const setup = () => mount(HRModules, { global: { plugins: [PrimeVue], stubs: { Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{label}}</button>' } } } });
const findSelect = (wrapper, inputId) => wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);
const selectValue = (wrapper, inputId) => findSelect(wrapper, inputId)?.props('modelValue');
const selectOptions = (wrapper, inputId) => findSelect(wrapper, inputId)?.props('options') || [];
const setSelect = async (wrapper, inputId, value) => {
    const select = findSelect(wrapper, inputId);
    expect(select, 'Select#' + inputId).toBeTruthy();
    select.vm.$emit('update:modelValue', value);
    await flushPromises();
};
it('reviews exact changes and reason before saving; planned modules have no controls', async () => {
    const w = setup();
    await flushPromises();
    expect(w.get('[data-testid="planned-modules"]').findAll('input,select,button')).toHaveLength(0);
    await setSelect(w, 'module-state', 'draining');
    await w.get('[data-testid="review"]').trigger('click');
    expect(m.repo.saveSettings).not.toHaveBeenCalled();
    expect(w.find('[data-testid="confirm-save"]').exists()).toBe(false);
    await w.get('#module-reason').setValue('예정 발령 정리');
    await w.get('[data-testid="review"]').trigger('click');
    expect(w.get('[data-testid="change-review"]').text()).toContain('예정 발령 정리');
    await w.get('[data-testid="confirm-save"]').trigger('click');
    await flushPromises();
    expect(m.repo.saveSettings).toHaveBeenCalledWith('a', 'hr.core', 0, 'draining', true, '예정 발령 정리');
    expect(m.runtime.refresh).toHaveBeenCalledWith('u', 'a');
});
it('preserves a draft on retry failure and ignores an older company response', async () => {
    const w = setup();
    await flushPromises();
    await w.get('#module-reason').setValue('보존 사유');
    m.repo.loadSettings.mockRejectedValueOnce(new Error('failed'));
    await w.get('[data-testid="reload"]').trigger('click');
    await flushPromises();
    expect(w.get('#module-reason').element.value).toBe('보존 사유');
    let resolve;
    m.repo.loadSettings.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await w.get('[data-testid="reload"]').trigger('click');
    await setSelect(w, 'module-company', 'b');
    await flushPromises();
    resolve(settings('a'));
    await flushPromises();
    expect(selectValue(w, 'module-company')).toBe('b');
    expect(w.get('#module-reason').element.value).toBe('');
});
it('invalidates pending loads when the identity becomes inactive', async () => {
    const w = setup();
    await flushPromises();
    let resolve;
    m.repo.loadSettings.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await w.get('[data-testid="reload"]').trigger('click');
    m.auth.profile.value.is_active = false;
    await flushPromises();
    resolve(settings());
    await flushPromises();
    expect(findSelect(w, 'module-state')).toBeUndefined();
    expect(selectOptions(w, 'module-company')).toHaveLength(1);
});
it('preserves the editor while a same-identity runtime refresh clears context', async () => {
    const w = setup();
    await flushPromises();
    m.runtime.refresh.mockImplementation(async () => {
        m.runtime.context.value = null;
    });
    await setSelect(w, 'module-state', 'draining');
    await w.get('#module-reason').setValue('운영 정리');
    await w.get('[data-testid="review"]').trigger('click');
    await w.get('[data-testid="confirm-save"]').trigger('click');
    await flushPromises();
    expect(findSelect(w, 'module-state')).toBeTruthy();
    expect(selectValue(w, 'module-company')).toBe('a');
});

it('immediately clears review and rejects pending results after admin role revocation', async () => {
    const w = setup();
    await flushPromises();
    await w.get('#module-reason').setValue('검토 중');
    await w.get('[data-testid="review"]').trigger('click');
    expect(w.find('[data-testid="confirm-save"]').exists()).toBe(true);
    let resolve;
    m.repo.loadSettings.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await w.get('[data-testid="reload"]').trigger('click');
    m.auth.profile.value.role = 'employee';
    m.auth.role.value = 'employee';
    await flushPromises();
    expect(w.find('#module-reason').exists()).toBe(false);
    expect(selectOptions(w, 'module-company')).toHaveLength(1);
    resolve(settings());
    await flushPromises();
    expect(findSelect(w, 'module-state')).toBeUndefined();
    await w.get('[data-testid="reload"]').trigger('click');
    await flushPromises();
    expect(m.catalog.listAdminCompanies).toHaveBeenCalledTimes(1);
    expect(m.repo.saveSettings).not.toHaveBeenCalled();
});
it('refreshes the current global company after a deferred save', async () => {
    const w = setup();
    await flushPromises();
    let resolve;
    m.repo.saveSettings.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await w.get('#module-reason').setValue('설정 변경');
    await w.get('[data-testid="review"]').trigger('click');
    await w.get('[data-testid="confirm-save"]').trigger('click');
    m.runtime.context.value = { companyId: 'b' };
    resolve(settings());
    await flushPromises();
    expect(m.runtime.refresh).toHaveBeenCalledWith('u', 'b');
});
it('does not supersede an in-flight global company selection after saving', async () => {
    const w = setup();
    await flushPromises();
    let resolve;
    m.repo.saveSettings.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await w.get('#module-reason').setValue('설정 변경');
    await w.get('[data-testid="review"]').trigger('click');
    await w.get('[data-testid="confirm-save"]').trigger('click');
    m.runtime.context.value = null;
    m.runtime.loading = ref(true);
    resolve(settings());
    await flushPromises();
    expect(m.runtime.refresh).not.toHaveBeenCalled();
    expect(w.text()).toContain('새로고침');
});
