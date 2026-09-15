// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { beforeEach, expect, it, vi } from 'vitest';
import EmployeeSecondaryAssignments from './EmployeeSecondaryAssignments.vue';

const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/repositories/hr/hrSecondaryAssignmentRepository', () => ({ createHrSecondaryAssignmentRepository: () => mocks.repo }));
const assignment = {
    id: 'a1',
    employmentId: 'cycle',
    employmentSequence: 1,
    siteId: 'site',
    department: 'DEV',
    grade: 'STAFF',
    position: 'TEAM_LEAD',
    startDate: '2026-09-01',
    endDate: null,
    status: 'active',
    reason: '지원',
    endReason: null,
    cancellationReason: null,
    revision: 1
};
const history = () => ({
    companyId: 'company',
    employeeId: 'employee',
    employeeRevision: 4,
    permissions: { create: true, end: true, cancel: true },
    assignments: [assignment, { ...assignment, id: 'a2', department: 'SALES', startDate: '2026-10-01', status: 'planned' }]
});
const preparation = () => ({
    companyId: 'company',
    employeeId: 'employee',
    employeeRevision: 4,
    primary: { employmentId: 'cycle', grade: 'STAFF' },
    employmentCycles: [{ id: 'cycle', endDate: null }],
    sites: [{ id: 'site', name: '서울 본사' }],
    references: [
        { kind: 'department', code: 'DEV', name: '개발팀' },
        { kind: 'department', code: 'SALES', name: '영업팀' },
        { kind: 'position', code: 'TEAM_LEAD', name: '팀장' }
    ],
    mappings: [{ kind: 'position', code: 'TEAM_LEAD', level: 4 }],
    permissions: { create: true }
});
beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.auth = { user: ref({ id: 'user' }) };
    mocks.repo = {
        loadHistory: vi.fn().mockResolvedValue(history()),
        prepare: vi.fn().mockResolvedValue(preparation()),
        create: vi.fn().mockResolvedValue(history()),
        end: vi.fn().mockResolvedValue(history()),
        cancel: vi.fn().mockResolvedValue(history())
    };
});
const setup = () => mount(EmployeeSecondaryAssignments, { props: { companyId: 'company', employeeId: 'employee' }, global: { plugins: [PrimeVue] } });
const setSelect = async (wrapper, inputId, value) => {
    const select = wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);
    expect(select, 'Select#' + inputId).toBeTruthy();
    select.vm.$emit('update:modelValue', value);
    await flushPromises();
};

it('reviews and creates a secondary assignment with its capped scope', async () => {
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.get('[data-testid="secondary-assignment-active"]').text()).toContain('개발팀');
    await wrapper.get('[data-testid="secondary-create-open"]').trigger('click');
    await setSelect(wrapper, 'secondary-site', 'site');
    await setSelect(wrapper, 'secondary-department', 'DEV');
    await setSelect(wrapper, 'secondary-position', 'TEAM_LEAD');
    await wrapper.get('#secondary-start-date').setValue('2026-10-01');
    await wrapper.get('#secondary-reason').setValue('개발팀장 겸직');
    await wrapper.get('[data-testid="secondary-review"]').trigger('click');
    expect(wrapper.get('[data-testid="secondary-review-panel"]').text()).toContain('개발팀 및 하위 조직');
    expect(wrapper.get('[data-testid="secondary-review-panel"]').text()).toContain('레벨 4');
    await wrapper.get('[data-testid="secondary-create-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.create).toHaveBeenCalledWith('company', 'employee', 4, expect.objectContaining({ employmentId: 'cycle', department: 'DEV', position: 'TEAM_LEAD' }), '개발팀장 겸직');
    expect(wrapper.emitted('changed')).toHaveLength(1);
});
it('ends active and cancels planned assignments through explicit forms', async () => {
    const wrapper = setup();
    await flushPromises();
    const rows = wrapper.findAll('[data-testid^="secondary-assignment-"]');
    await rows[0].get('button').trigger('click');
    await wrapper.get('#secondary-action-end').setValue('2026-09-30');
    await wrapper.get('#secondary-action-reason').setValue('업무 종료');
    await wrapper.get('[data-testid="secondary-action-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.end).toHaveBeenCalledWith('company', 'employee', 'a1', 4, 1, '2026-09-30', '업무 종료');
    await rows[1].get('button').trigger('click');
    await wrapper.get('#secondary-action-reason').setValue('일정 변경');
    await wrapper.get('[data-testid="secondary-action-save"]').trigger('click');
    await flushPromises();
    expect(mocks.repo.cancel).toHaveBeenCalledWith('company', 'employee', 'a2', 4, 1, '일정 변경');
});
it('renders read-only and discards stale employee responses', async () => {
    let resolveOld;
    mocks.repo.loadHistory.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)));
    const wrapper = setup();
    mocks.repo.loadHistory.mockResolvedValue({ ...history(), employeeId: 'other', permissions: { create: false, end: false, cancel: false }, assignments: [] });
    mocks.repo.prepare.mockResolvedValue({ ...preparation(), employeeId: 'other' });
    await wrapper.setProps({ employeeId: 'other' });
    await flushPromises();
    resolveOld(history());
    await flushPromises();
    expect(wrapper.get('[data-testid="secondary-readonly"]').text()).toContain('조회만');
    expect(wrapper.find('[data-testid="secondary-assignment-active"]').exists()).toBe(false);
});
