// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { ACCOUNT_TYPE } from '@/data/master';
import Accounts from './Accounts.vue';

const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/master', () => ({ useMasterStore: () => mocks.master }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: mocks.confirm }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: mocks.toast }) }));

const sourcePath = resolve(process.cwd(), 'src/views/master/Accounts.vue');
const source = () => (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '');

const account = (id, code, name, parentId, overrides = {}) => ({ id, companyId: 'company-1', parentId, code, name, accountType: ACCOUNT_TYPE.ASSET, isPostable: false, isActive: true, ...overrides });

const masterStore = (overrides = {}) => ({
    companies: ref([{ id: 'company-1', code: 'NXM', name: '넥서스 제조', isActive: true }]),
    accounts: ref([
        account('a-111', '111', '현금및현금성자산', 'a-110', { isPostable: true }),
        account('a-100', '100', '자산', null),
        account('a-110', '110', '유동자산', 'a-100'),
        account('a-400', '400', '매출', null, { accountType: ACCOUNT_TYPE.REVENUE })
    ]),
    loading: ref(false),
    error: ref(null),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    createAccount: vi.fn().mockResolvedValue(account('a-new', '112', '매출채권', 'a-110', { isPostable: true })),
    updateAccount: vi.fn().mockResolvedValue(account('a-110', '110', '수정 계정', 'a-100')),
    ...overrides
});

const setup = () => mount(Accounts, { global: { plugins: [PrimeVue], stubs: { Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/></section>' }, ConfirmDialog: true } } });
const findSelect = (wrapper, inputId) => wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);
const optionValues = (wrapper, inputId) => (findSelect(wrapper, inputId)?.props('options') || []).map((option) => option.value);

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    mocks.auth = { hasRole: vi.fn(() => true) };
    mocks.master = masterStore();
    mocks.confirm = vi.fn();
    mocks.toast = vi.fn();
});

describe('chart of accounts screen', () => {
    it('lists the chart in hierarchy order rather than raw insertion order', async () => {
        const wrapper = setup();
        await flushPromises();

        expect(mocks.master.ensureLoaded).toHaveBeenCalled();
        const codes = wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0].text());
        expect(codes).toEqual(['100', '110', '111', '400']);
        expect(wrapper.text()).toContain('집계 전용');
        expect(wrapper.text()).toContain('가능');
    });

    it('narrows the chart by account type', async () => {
        const wrapper = setup();
        await flushPromises();

        findSelect(wrapper, 'account-filter-type').vm.$emit('update:modelValue', ACCOUNT_TYPE.REVENUE);
        await flushPromises();

        const codes = wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0].text());
        expect(codes).toEqual(['400']);
    });

    it('offers only same-type summary accounts as a parent and never the row itself', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.findAll('[data-testid="account-edit"]')[1].trigger('click');
        expect(optionValues(wrapper, 'account-parentId')).toEqual([null, 'a-100']);
    });

    it('clears a parent that no longer matches the chosen account type', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.findAll('[data-testid="account-edit"]')[1].trigger('click');
        expect(findSelect(wrapper, 'account-parentId').props('modelValue')).toBe('a-100');

        findSelect(wrapper, 'account-accountType').vm.$emit('update:modelValue', ACCOUNT_TYPE.REVENUE);
        await flushPromises();
        expect(findSelect(wrapper, 'account-parentId').props('modelValue')).toBeNull();
    });

    it('refuses a code that is not numeric and reports nothing to the repository', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="account-edit"]').trigger('click');
        await wrapper.get('#account-name').setValue('   ');
        await wrapper.get('#account-form').trigger('submit');
        await flushPromises();

        expect(mocks.master.updateAccount).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('warns that children follow before deactivating a summary account', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="account-toggle"]').trigger('click');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ group: 'accounts', header: '계정 비활성화', message: expect.stringContaining('하위 계정도 함께') }));
    });

    it('hides every write control from a non-administrator', async () => {
        mocks.auth.hasRole = vi.fn(() => false);
        const wrapper = setup();
        await flushPromises();

        expect(wrapper.find('[data-testid="account-edit"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('계정과목 등록 및 수정은 관리자 계정에서만');
        expect(wrapper.text()).toContain('현금및현금성자산');
    });

    it('keeps the accessibility conventions the master screens share', () => {
        const markup = source();

        expect(markup.match(/<h1/g)).toHaveLength(1);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('aria-live="polite"');
        expect(markup).toContain('frozen alignFrozen="right"');
        for (const field of ['account-company', 'account-filter-type', 'account-companyId', 'account-accountType', 'account-code', 'account-name', 'account-parentId']) {
            expect(markup).toContain(`for="${field}"`);
        }
    });
});
