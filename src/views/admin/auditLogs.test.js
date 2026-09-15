// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { AUDIT_ACTION } from '@/data/audit';
import AuditLogs from './AuditLogs.vue';

const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/audit', () => ({ useAuditStore: () => mocks.audit }));
vi.mock('@/services/adminApi', () => ({ useAdminApi: () => mocks.adminApi }));

const sourcePath = resolve(process.cwd(), 'src/views/admin/AuditLogs.vue');
const source = () => (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '');

const entry = (overrides = {}) => ({
    id: 1,
    tableName: 'companies',
    recordId: 'company-1',
    companyId: 'company-1',
    action: AUDIT_ACTION.UPDATE,
    actorId: 'actor-1',
    changedAt: '2026-09-15T01:00:00.000Z',
    oldData: { id: 'company-1', code: 'NXM', name: '넥서스 제조', representative: '' },
    newData: { id: 'company-1', code: 'NXM', name: '넥서스 제조', representative: '김대표' },
    ...overrides
});

const auditStore = (overrides = {}) => {
    const total = ref(1);
    const store = {
        entries: ref([entry()]),
        total,
        page: ref(1),
        pageCount: computed(() => 1),
        filter: ref({ tableName: null, actorId: null, action: null, from: null, to: null, page: 1 }),
        hasFilters: computed(() => false),
        loading: ref(false),
        loaded: ref(true),
        error: ref(null),
        ensureLoaded: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        applyFilter: vi.fn().mockResolvedValue(undefined),
        resetFilter: vi.fn().mockResolvedValue(undefined),
        goToPage: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
    return store;
};

const setup = () =>
    mount(AuditLogs, {
        global: {
            plugins: [PrimeVue],
            stubs: { Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/></section>' } }
        }
    });

const findSelect = (wrapper, inputId) => wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.auth = { hasRole: vi.fn(() => true) };
    mocks.audit = auditStore();
    mocks.adminApi = { listAccounts: vi.fn().mockResolvedValue([{ id: 'actor-1', email: 'admin@nexerp.test', displayName: '시스템 관리자' }]) };
});

describe('audit log screen', () => {
    it('loads the ledger and resolves actor identifiers to account names', async () => {
        const wrapper = setup();
        await flushPromises();

        expect(mocks.audit.ensureLoaded).toHaveBeenCalled();
        expect(mocks.adminApi.listAccounts).toHaveBeenCalled();
        expect(wrapper.text()).toContain('시스템 관리자');
        expect(wrapper.text()).toContain('회사');
        expect(wrapper.text()).toContain('수정');
    });

    it('keeps the screen readable when the account directory is unavailable', async () => {
        mocks.adminApi.listAccounts = vi.fn().mockRejectedValue(new Error('unavailable'));
        const wrapper = setup();
        await flushPromises();

        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('확인할 수 없는 계정');
    });

    it('sends each filter change to the store and restarts from the first page', async () => {
        const wrapper = setup();
        await flushPromises();

        findSelect(wrapper, 'audit-table').vm.$emit('update:modelValue', 'sites');
        findSelect(wrapper, 'audit-action').vm.$emit('update:modelValue', AUDIT_ACTION.INSERT);
        findSelect(wrapper, 'audit-actor').vm.$emit('update:modelValue', 'actor-1');
        await flushPromises();

        expect(mocks.audit.applyFilter).toHaveBeenNthCalledWith(1, { tableName: 'sites' });
        expect(mocks.audit.applyFilter).toHaveBeenNthCalledWith(2, { action: AUDIT_ACTION.INSERT });
        expect(mocks.audit.applyFilter).toHaveBeenNthCalledWith(3, { actorId: 'actor-1' });
    });

    it('shows only the fields that changed in the detail dialog', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="audit-detail"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('대표자');
        expect(wrapper.text()).toContain('김대표');
        expect(wrapper.text()).not.toContain('넥서스 제조 주식회사');
    });

    it('tells a non-administrator that the ledger is out of reach and asks the server for nothing', async () => {
        mocks.auth.hasRole = vi.fn(() => false);
        const wrapper = setup();
        await flushPromises();

        expect(mocks.audit.ensureLoaded).not.toHaveBeenCalled();
        expect(mocks.adminApi.listAccounts).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('감사 로그는 관리자 계정에서만 조회할 수 있습니다.');
        expect(wrapper.find('table').exists()).toBe(false);
    });

    it('offers to clear an active filter from the empty state', async () => {
        mocks.audit = auditStore({ entries: ref([]), total: ref(0), hasFilters: computed(() => true) });
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="audit-reset"]').trigger('click');
        expect(mocks.audit.resetFilter).toHaveBeenCalled();
    });

    it('keeps the accessibility conventions the administrator screens share', () => {
        const markup = source();

        expect(markup.match(/<h1/g)).toHaveLength(1);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('aria-live="polite"');
        expect(markup).toContain('frozen alignFrozen="right"');
        for (const field of ['audit-table', 'audit-action', 'audit-actor', 'audit-from', 'audit-to']) {
            expect(markup).toContain(`for="${field}"`);
            expect(markup).toContain(`inputId="${field}"`);
        }
    });
});
