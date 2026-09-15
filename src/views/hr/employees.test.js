// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { beforeEach, expect, it, vi } from 'vitest';
import Employees from './Employees.vue';
const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/hrReference', () => ({ useHrReferenceStore: () => mocks.references }));
vi.mock('@/repositories/hr/hrRepository', () => ({ createHrRepository: () => ({ loadCorrections: (...args) => mocks.corrections(...args) }) }));
vi.mock('@/stores/hr', () => ({ useHrStore: () => mocks.hr }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => mocks.runtime }));
vi.mock('./EmployeeAccount.vue', () => ({
    default: { props: ['companyId', 'employeeId'], emits: ['changed'], template: '<section data-testid="employee-account"><button data-testid="account-changed" @click="$emit(\'changed\')">계정 변경</button></section>' }
}));
vi.mock('./EmployeeEmployment.vue', () => ({
    default: { props: ['companyId', 'employeeId'], emits: ['changed'], template: '<section data-testid="employee-employment"><button data-testid="employment-changed" @click="$emit(\'changed\')">고용 변경</button></section>' }
}));
const employee = { id: 'employee', employeeNo: 'E1', name: '홍길동', status: 'active', revision: 3, actions: [] };
beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.references = { catalog: ref([]), canManage: ref(false), loading: ref(false), saving: ref(false), error: ref(null), reset: vi.fn(), load: vi.fn() };
    mocks.corrections = vi.fn().mockResolvedValue([]);
    mocks.auth = { user: ref({ id: 'user' }) };
    mocks.runtime = { context: ref({ companyId: 'company', mode: 'active' }), refresh: vi.fn().mockResolvedValue(true) };
    mocks.hr = {
        directory: ref({ employees: [employee], permissions: { create: true, update: true, cancel: true }, sites: [], accounts: [], total: 1, page: 1, pageSize: 25 }),
        loading: ref(false),
        saving: ref(false),
        error: ref(null),
        reset: vi.fn(),
        load: vi.fn(),
        recordAction: vi.fn().mockResolvedValue(true),
        createEmployee: vi.fn().mockResolvedValue(true),
        correctEmployee: vi.fn().mockResolvedValue(true),
        cancelAction: vi.fn().mockResolvedValue(true)
    };
});
const setup = () =>
    mount(Employees, {
        global: {
            plugins: [PrimeVue],
            stubs: {
                Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/><slot name="footer"/></section>' },
                Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}<slot/></button>' }
            }
        }
    });
const findSelect = (wrapper, inputId) => wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);
const selectLabels = (wrapper, inputId) => (findSelect(wrapper, inputId)?.props('options') || []).map((option) => option.label);
const setSelect = async (wrapper, inputId, value) => {
    const select = findSelect(wrapper, inputId);
    expect(select, 'Select#' + inputId).toBeTruthy();
    select.vm.$emit('update:modelValue', value);
    await flushPromises();
};
it('registers with an optional eligible account selection without exposing UUID entry', async () => {
    mocks.hr.directory.value.accounts = [{ id: 'account-id', name: '김직원' }];
    const wrapper = setup();
    await wrapper.get('[data-testid="register"]').trigger('click');
    expect(selectLabels(wrapper, 'profile-id')).toContain('김직원');
    await wrapper.get('#employee-no').setValue('E2');
    await wrapper.get('#employee-name').setValue('김직원');
    await setSelect(wrapper, 'profile-id', 'account-id');
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
it('mounts account management for the selected employee and refreshes after a change', async () => {
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    expect(wrapper.get('[data-testid="employee-account"]').exists()).toBe(true);
    await wrapper.get('[data-testid="account-changed"]').trigger('click');
    await flushPromises();
    expect(mocks.hr.load).toHaveBeenLastCalledWith('company', '', 1);
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
});
it('mounts employment cycles and refreshes directory access after rehire changes', async () => {
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    expect(wrapper.get('[data-testid="employee-employment"]').exists()).toBe(true);
    await wrapper.get('[data-testid="employment-changed"]').trigger('click');
    await flushPromises();
    expect(mocks.hr.load).toHaveBeenLastCalledWith('company', '', 1);
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
});
it('requires a reason and explicit termination confirmation then refreshes access', async () => {
    const wrapper = setup();
    await wrapper.get('[data-testid="employee-detail"]').trigger('click');
    await wrapper.get('[data-testid="action"]').trigger('click');
    await setSelect(wrapper, 'action-type', 'terminate');
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
    await wrapper.get('#employee-search-form').trigger('submit');
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

it('corrects the employee name while employment dates remain cycle-owned', async () => {
    mocks.hr.directory.value.employees = [{ ...employee, hireDate: '2026-01-01' }];
    const w = setup();
    await w.get('[data-testid="employee-detail"]').trigger('click');
    await w.get('[data-testid="correct-employee"]').trigger('click');
    await w.get('#correction-name').setValue('김직원');
    expect(w.find('#correction-date').exists()).toBe(false);
    await w.get('#action-reason').setValue('입력 오류 정정');
    await w.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.correctEmployee).toHaveBeenCalledWith('employee', 3, { name: '김직원' }, '입력 오류 정정');
});
it('rejects stale correction history after employee changes', async () => {
    let done;
    mocks.corrections
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    done = resolve;
                })
        )
        .mockResolvedValue([]);
    mocks.hr.directory.value.employees = [employee, { ...employee, id: 'second', name: '둘째' }];
    const w = setup();
    await w.findAll('[data-testid="employee-detail"]')[0].trigger('click');
    await w.findAll('[data-testid="employee-detail"]')[1].trigger('click');
    done([{ id: 'old', before: { name: '옛이름' }, after: { name: '새이름' }, reason: 'stale secret', createdAt: '2026-01-01' }]);
    await flushPromises();
    expect(w.text()).not.toContain('stale secret');
});
it('shows names and codes, blocks inactive transfers but permits termination', async () => {
    mocks.references.catalog.value = [
        { id: 'd', kind: 'department', code: 'OLD', name: '옛 부서', isActive: false },
        { id: 'new', kind: 'department', code: 'NEW', name: '새 부서', isActive: true }
    ];
    mocks.hr.directory.value.employees = [{ ...employee, department: 'OLD' }];
    const w = setup();
    await w.get('[data-testid="employee-detail"]').trigger('click');
    await w.get('[data-testid="action"]').trigger('click');
    expect(selectLabels(w, 'employee-department')).toContain('옛 부서 (OLD) · 사용 중지 또는 미조회');
    expect(selectLabels(w, 'employee-department')).toContain('새 부서 (NEW)');
    await w.get('#action-reason').setValue('배정');
    await w.get('[data-testid="save-action"]').trigger('submit');
    expect(mocks.hr.recordAction).not.toHaveBeenCalled();
    await setSelect(w, 'action-type', 'terminate');
    await w.get('#impact-confirm').setValue(true);
    await w.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.recordAction).toHaveBeenCalled();
});
it('clears pending correction history on identity switch', async () => {
    let done;
    mocks.corrections.mockImplementation(
        () =>
            new Promise((resolve) => {
                done = resolve;
            })
    );
    const w = setup();
    await w.get('[data-testid="employee-detail"]').trigger('click');
    mocks.auth.user.value = { id: 'other' };
    done([{ id: 'private', before: { name: 'old' }, after: { name: 'new' }, reason: 'private reason', createdAt: 'now' }]);
    await flushPromises();
    expect(w.text()).not.toContain('private reason');
    expect(mocks.references.reset).toHaveBeenCalledTimes(2);
});
it('refreshes access after correction while audit history is still pending', async () => {
    let resolveHistory;
    mocks.corrections.mockResolvedValueOnce([]).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveHistory = resolve;
            })
    );
    mocks.hr.directory.value.employees = [{ ...employee, hireDate: '2026-01-01' }];
    const w = setup();
    await w.get('[data-testid="employee-detail"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="correct-employee"]').trigger('click');
    await w.get('#correction-name').setValue('김직원');
    await w.get('#action-reason').setValue('이름 정정');
    await w.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.correctEmployee).toHaveBeenCalled();
    expect(resolveHistory).toBeTypeOf('function');
    expect(mocks.runtime.refresh).toHaveBeenCalledWith('user', 'company');
    resolveHistory([]);
    await flushPromises();
});
it('shows draining guidance and permits cancellation independently of update', async () => {
    mocks.hr.directory.value.moduleState = 'draining';
    mocks.hr.directory.value.permissions = { create: false, update: false, cancel: true };
    mocks.hr.directory.value.employees = [{ ...employee, actions: [{ id: 'future', type: 'transfer', effectiveDate: '2099-01-01', cancelled: false }] }];
    const w = setup();
    expect(w.get('[data-testid="module-state-banner"]').text()).toContain('진행 건 정리');
    await w.get('[data-testid="employee-detail"]').trigger('click');
    expect(w.find('[data-testid="action"]').exists()).toBe(false);
    await w
        .findAll('button')
        .find((b) => b.text() === '발령 취소')
        .trigger('click');
    await w.get('#action-reason').setValue('종료 전 정리');
    await w.get('#impact-confirm').setValue(true);
    await w.get('[data-testid="save-action"]').trigger('submit');
    await flushPromises();
    expect(mocks.hr.cancelAction).toHaveBeenCalledWith('employee', 'future', 3, '종료 전 정리');
});
it('never uses update as a fallback for cancellation', async () => {
    mocks.hr.directory.value.employees = [{ ...employee, actions: [{ id: 'future', type: 'transfer', effectiveDate: '2099-01-01', cancelled: false }] }];
    delete mocks.hr.directory.value.permissions.cancel;
    const w = setup();
    await w.get('[data-testid="employee-detail"]').trigger('click');
    expect(w.findAll('button').some((b) => b.text() === '발령 취소')).toBe(false);
});
