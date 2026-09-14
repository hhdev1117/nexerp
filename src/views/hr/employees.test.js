// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import Employees from './Employees.vue';
const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/hr', () => ({ useHrStore: () => mocks.hr }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => mocks.runtime }));
const employee = { id: 'employee', employeeNo: 'E1', name: '홍길동', status: 'active', revision: 3, actions: [] };
beforeEach(() => {
    mocks.auth = { user: ref({ id: 'user' }) };
    mocks.runtime = { context: ref({ companyId: 'company', mode: 'active' }), refresh: vi.fn().mockResolvedValue(true) };
    mocks.hr = {
        directory: ref({ employees: [employee], permissions: { create: true, update: true }, sites: [], accounts: [], total: 1, page: 1, pageSize: 25 }),
        loading: ref(false),
        saving: ref(false),
        error: ref(null),
        reset: vi.fn(),
        load: vi.fn(),
        recordAction: vi.fn().mockResolvedValue(true),
        createEmployee: vi.fn().mockResolvedValue(true),
        cancelAction: vi.fn().mockResolvedValue(true)
    };
});
const setup = () =>
    mount(Employees, {
        global: { stubs: { Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/><slot name="footer"/></section>' }, Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}<slot/></button>' } } }
    });
it('registers with an optional eligible account selection without exposing UUID entry', async () => {
    mocks.hr.directory.value.accounts = [{ id: 'account-id', name: '김직원' }];
    const wrapper = setup();
    await wrapper.get('[data-testid="register"]').trigger('click');
    expect(wrapper.get('#profile-id').element.tagName).toBe('SELECT');
    expect(wrapper.get('#profile-id').text()).toContain('김직원');
    await wrapper.get('#employee-no').setValue('E2');
    await wrapper.get('#employee-name').setValue('김직원');
    await wrapper.get('#profile-id').setValue('account-id');
    await wrapper.get('#action-reason').setValue('신규 입사');
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ employeeNo: 'E2', name: '김직원', profileId: 'account-id' }), '신규 입사');
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
});
it('loads only the current company and resets open registration on identity change', async () => {
    const wrapper = setup();
    expect(mocks.hr.load).toHaveBeenCalledWith('company', '', 1);
    await wrapper.get('[data-testid="register"]').trigger('click');
    expect(wrapper.find('#employee-no').exists()).toBe(true);
    mocks.auth.user.value = { id: 'other' };
    await flushPromises();
    expect(wrapper.find('#employee-no').exists()).toBe(false);
    expect(mocks.hr.reset).toHaveBeenCalledTimes(2);
});
it('requires a reason and explicit termination confirmation then refreshes access', async () => {
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    await wrapper.get('[data-testid="action"]').trigger('click');
    await wrapper.get('#action-type').setValue('terminate');
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    expect(mocks.hr.recordAction).not.toHaveBeenCalled();
    await wrapper.get('#action-reason').setValue('계약 종료');
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    expect(mocks.hr.recordAction).not.toHaveBeenCalled();
    await wrapper.get('#impact-confirm').setValue(true);
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.recordAction).toHaveBeenCalledWith('employee', 3, expect.objectContaining({ type: 'terminate', reason: '계약 종료' }));
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
});
it('hides writes without directory permissions and shows server errors', async () => {
    mocks.hr.directory.value.permissions = { create: false, update: false };
    mocks.hr.error.value = '인사 정보를 불러오지 못했습니다.';
    const wrapper = setup();
    expect(wrapper.find('[data-testid="register"]').exists()).toBe(false);
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    expect(wrapper.find('[data-testid="action"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('불러오지');
});
it('cancels only the latest future action with an audited reason and confirmation', async () => {
    mocks.hr.directory.value.employees = [
        {
            ...employee,
            actions: [
                { id: 'old', type: 'transfer', effectiveDate: '2099-01-01', reason: '이동', cancelled: false },
                { id: 'latest', type: 'terminate', effectiveDate: '2099-02-01', reason: '종료', cancelled: false }
            ]
        }
    ];
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    const cancellations = wrapper.findAll('button').filter((button) => button.text() === '발령 취소');
    expect(cancellations).toHaveLength(1);
    await cancellations[0].trigger('click');
    await wrapper.get('#action-reason').setValue('퇴사 일정 철회');
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    expect(mocks.hr.cancelAction).not.toHaveBeenCalled();
    await wrapper.get('#impact-confirm').setValue(true);
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.cancelAction).toHaveBeenCalledWith('employee', 'latest', 3, '퇴사 일정 철회');
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
});
it('submits server search and clears employee selection on company changes', async () => {
    const wrapper = setup();
    await wrapper.get('#employee-search').setValue('  홍길동  ');
    await wrapper.get('.hr-search').trigger('submit');
    expect(mocks.hr.load).toHaveBeenLastCalledWith('company', '홍길동', 1);
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    mocks.runtime.context.value = { mode: 'active', companyId: 'next-company' };
    await flushPromises();
    expect(wrapper.find('[aria-label="선택한 직원 상세"]').exists()).toBe(false);
    expect(wrapper.get('#employee-search').element.value).toBe('');
    expect(mocks.hr.load).toHaveBeenLastCalledWith('next-company', '', 1);
});
it('does not refresh another identity after an in-flight mutation', async () => {
    let resolve;
    mocks.hr.recordAction.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done;
            })
    );
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    await wrapper.get('[data-testid="action"]').trigger('click');
    await wrapper.get('#action-reason').setValue('이동');
    await wrapper.get('[data-testid="save-action"]').trigger('submit');
    mocks.auth.user.value = { id: 'other' };
    resolve(true);
    await flushPromises();
    expect(mocks.runtime.refresh).not.toHaveBeenCalled();
});
