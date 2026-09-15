// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { beforeEach, expect, it, vi } from 'vitest';
import EmployeeEmployment from './EmployeeEmployment.vue';
const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/repositories/hr/hrEmploymentRepository', () => ({ createHrEmploymentRepository: () => mocks.repo }));
const profile = '44444444-4444-4444-8444-444444444444';
const cycle1 = '33333333-3333-4333-8333-333333333333';
const cycle2 = '55555555-5555-4555-8555-555555555555';
const history = () => ({
    companyId: 'company',
    employeeId: 'employee',
    employeeRevision: 4,
    permissions: { create: true, cancel: true },
    employments: [
        {
            id: cycle1,
            sequenceNo: 1,
            hireDate: '2020-01-01',
            endDate: '2026-09-15',
            status: 'terminated',
            siteId: null,
            department: 'D1',
            grade: 'STAFF',
            position: 'MEMBER',
            cancelled: false,
            cancellationReason: null,
            accountChanged: false,
            actions: []
        },
        { id: cycle2, sequenceNo: 2, hireDate: '2026-10-01', endDate: null, status: 'planned', siteId: null, department: 'D1', grade: 'STAFF', position: 'TEAM_LEAD', cancelled: false, cancellationReason: null, accountChanged: true, actions: [] }
    ]
});
const preparation = () => ({
    companyId: 'company',
    employeeId: 'employee',
    employeeRevision: 4,
    eligible: true,
    earliestHireDate: '2026-09-16',
    currentAccount: { id: profile, name: '기존계정' },
    accountCandidates: [
        { id: profile, name: '기존계정', preview: { level: 1, source: 'grade' } },
        { id: '66666666-6666-4666-8666-666666666666', name: '신규계정', preview: { level: null, source: 'unmapped' } }
    ],
    sites: [{ id: '77777777-7777-4777-8777-777777777777', name: '서울 본사' }],
    references: [
        { id: '81111111-1111-4111-8111-111111111111', kind: 'department', code: 'D1', name: '지원팀' },
        { id: '82222222-2222-4222-8222-222222222222', kind: 'grade', code: 'STAFF', name: '사원' },
        { id: '83333333-3333-4333-8333-333333333333', kind: 'position', code: 'MEMBER', name: '팀원' },
        { id: '84444444-4444-4444-8444-444444444444', kind: 'position', code: 'TEAM_LEAD', name: '팀장' }
    ],
    mappings: [
        { kind: 'grade', code: 'STAFF', level: 1, from: null, to: null },
        { kind: 'position', code: 'TEAM_LEAD', level: 4, from: null, to: null }
    ],
    permissions: { create: true }
});
beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.auth = { user: ref({ id: 'user' }) };
    mocks.repo = {
        loadHistory: vi.fn().mockResolvedValue({ ...history(), employments: [history().employments[0]] }),
        prepareRehire: vi.fn().mockResolvedValue(preparation()),
        createReemployment: vi.fn().mockResolvedValue(history()),
        cancelPlanned: vi.fn().mockResolvedValue({ ...history(), employeeRevision: 5, employments: [history().employments[0], { ...history().employments[1], status: 'cancelled', cancelled: true, cancellationReason: '일정 변경' }] })
    };
});
const setup = () =>
    mount(EmployeeEmployment, {
        props: { companyId: 'company', employeeId: 'employee' },
        global: {
            plugins: [PrimeVue],
            stubs: { Button: { props: ['label', 'disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')">{{label}}</button>' } }
        }
    });
const setSelect = async (wrapper, inputId, value) => {
    const select = wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);
    expect(select, 'Select#' + inputId).toBeTruthy();
    select.vm.$emit('update:modelValue', value);
    await flushPromises();
};
it('shows each cycle and reviews a rehire with position-first access preview', async () => {
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.get('[data-testid="employment-cycle-1"]').text()).toContain('1회차');
    await wrapper.get('[data-testid="rehire-open"]').trigger('click');
    await wrapper.get('#rehire-date').setValue('2026-10-01');
    await setSelect(wrapper, 'rehire-department', 'D1');
    await setSelect(wrapper, 'rehire-grade', 'STAFF');
    await setSelect(wrapper, 'rehire-position', 'TEAM_LEAD');
    await setSelect(wrapper, 'rehire-account-mode', 'replace');
    await setSelect(wrapper, 'rehire-profile', '66666666-6666-4666-8666-666666666666');
    await wrapper.get('#rehire-reason').setValue('재입사 승인');
    await wrapper.get('[data-testid="rehire-review"]').trigger('click');
    expect(wrapper.get('[data-testid="rehire-review-panel"]').text()).toContain('레벨 4 · 직책 매핑');
    await wrapper.get('[data-testid="rehire-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.createReemployment).toHaveBeenCalledWith(
        'company',
        'employee',
        4,
        expect.objectContaining({ hireDate: '2026-10-01', position: 'TEAM_LEAD', accountMode: 'replace', profileId: '66666666-6666-4666-8666-666666666666' }),
        '재입사 승인'
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.get('[data-testid="employment-cycle-2"]').text()).toContain('재직 예정');
});
it('requires the earliest date, reason and account for replacement', async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('[data-testid="rehire-open"]').trigger('click');
    await wrapper.get('#rehire-date').setValue('2026-09-15');
    await setSelect(wrapper, 'rehire-account-mode', 'replace');
    await wrapper.get('[data-testid="rehire-review"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('2026-09-16');
    expect(mocks.repo.createReemployment).not.toHaveBeenCalled();
});
it('cancels only a planned cycle after reason and explicit confirmation', async () => {
    mocks.repo.loadHistory.mockResolvedValue(history());
    const wrapper = setup();
    await flushPromises();
    await wrapper.get('[data-testid="employment-cancel-open"]').trigger('click');
    await wrapper.get('[data-testid="employment-cancel-save"]').trigger('click');
    expect(mocks.repo.cancelPlanned).not.toHaveBeenCalled();
    await wrapper.get('#employment-cancel-reason').setValue('일정 변경');
    await wrapper.get('#employment-cancel-confirm').setValue(true);
    await wrapper.get('[data-testid="employment-cancel-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.cancelPlanned).toHaveBeenCalledWith('company', 'employee', cycle2, 4, '일정 변경');
    expect(wrapper.text()).toContain('취소됨');
});
it('shows read-only state without false controls', async () => {
    mocks.repo.loadHistory.mockResolvedValue({ ...history(), permissions: { create: false, cancel: false }, employments: [history().employments[0]] });
    mocks.repo.prepareRehire.mockResolvedValue({ ...preparation(), permissions: { create: false } });
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.find('[data-testid="rehire-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="employment-cancel-open"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="employment-readonly"]').text()).toContain('조회만');
});
it('discards stale responses after employee and identity changes', async () => {
    let resolveHistory;
    mocks.repo.loadHistory.mockImplementationOnce(() => new Promise((resolve) => (resolveHistory = resolve)));
    const wrapper = setup();
    mocks.repo.loadHistory.mockResolvedValue({ ...history(), employeeId: 'other', employments: [] });
    mocks.repo.prepareRehire.mockResolvedValue({ ...preparation(), employeeId: 'other', eligible: false });
    await wrapper.setProps({ employeeId: 'other' });
    await flushPromises();
    resolveHistory(history());
    await flushPromises();
    expect(wrapper.find('[data-testid="employment-cycle-1"]').exists()).toBe(false);
    mocks.auth.user.value = { id: 'other-user' };
    await flushPromises();
    expect(mocks.repo.loadHistory).toHaveBeenCalledWith('company', 'other');
});
