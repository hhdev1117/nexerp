// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import EmployeeAccount from './EmployeeAccount.vue';
const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/repositories/hr/hrAccountRepository', () => ({ createHrAccountRepository: () => mocks.repo }));
const profile = '33333333-3333-4333-8333-333333333333';
const data = () => ({
    companyId: 'company',
    employeeId: 'employee',
    employeeNo: 'E1',
    name: '김사원',
    revision: 2,
    status: 'active',
    grade: 'STAFF',
    position: 'MEMBER',
    account: null,
    candidates: [{ id: profile, name: '김계정', preview: { level: 1, source: 'grade' } }],
    permissions: { link: true, unlink: false }
});
beforeEach(() => {
    mocks.auth = { user: ref({ id: 'user' }) };
    mocks.repo = {
        loadOptions: vi.fn().mockResolvedValue(data()),
        loadHistory: vi.fn().mockResolvedValue([]),
        linkAccount: vi.fn().mockResolvedValue({ ...data(), revision: 3, account: { id: profile, name: '김계정', listed: true, preview: { level: 1, source: 'grade' } }, permissions: { link: true, unlink: true } })
    };
});
const setup = () =>
    mount(EmployeeAccount, {
        props: { companyId: 'company', employeeId: 'employee' },
        global: { stubs: { Button: { props: ['label', 'disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')">{{label}}</button>' } } }
    });
it('previews the mapped level and requires reason plus review before linking', async () => {
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.get('[data-testid="account-current"]').text()).toContain('연결 없음');
    expect(wrapper.get('#account-choice').text()).toContain('레벨 1 · 직급 매핑');
    await wrapper.get('#account-choice').setValue(profile);
    await wrapper.get('[data-testid="account-review"]').trigger('click');
    expect(mocks.repo.linkAccount).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('변경 사유');
    await wrapper.get('#account-reason').setValue('신규 계정 연결');
    await wrapper.get('[data-testid="account-review"]').trigger('click');
    expect(wrapper.get('[data-testid="account-review-panel"]').text()).toContain('연결 없음 → 김계정');
    await wrapper.get('[data-testid="account-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.linkAccount).toHaveBeenCalledWith('company', 'employee', 2, profile, '신규 계정 연결');
    expect(wrapper.emitted('changed')).toHaveLength(1);
});
it('shows read-only state and disables replacement for a terminated employee', async () => {
    mocks.repo.loadOptions.mockResolvedValue({ ...data(), status: 'terminated', permissions: { link: false, unlink: false }, candidates: [] });
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.get('[data-testid="account-terminated"]').text()).toContain('새 계정');
    expect(wrapper.get('[data-testid="account-readonly"]').exists()).toBe(true);
    expect(wrapper.find('#account-choice').exists()).toBe(false);
});
it('discards stale employee results and reports load failures safely', async () => {
    let resolve;
    mocks.repo.loadOptions.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const wrapper = setup();
    mocks.repo.loadOptions.mockResolvedValue({ ...data(), employeeId: 'other', candidates: [] });
    await wrapper.setProps({ employeeId: 'other' });
    await flushPromises();
    resolve(data());
    await flushPromises();
    expect(wrapper.text()).not.toContain('김계정');
    mocks.repo.loadOptions.mockRejectedValueOnce(new Error('secret'));
    await wrapper.get('[data-testid="account-reload"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('불러오지 못했습니다');
    expect(wrapper.text()).not.toContain('secret');
});
