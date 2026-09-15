// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { ITEM_TYPE } from '@/data/master';
import Items from './Items.vue';

const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/master', () => ({ useMasterStore: () => mocks.master }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: mocks.confirm }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: mocks.toast }) }));

const sourcePath = resolve(process.cwd(), 'src/views/master/Items.vue');
const source = () => (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '');

const item = (overrides = {}) => ({ id: 'item-1', companyId: 'company-1', code: 'RM-AL-001', name: '알루미늄 시트 2T', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 120, standardPrice: 15000, isActive: true, ...overrides });

const masterStore = (overrides = {}) => ({
    companies: ref([{ id: 'company-1', code: 'NXM', name: '넥서스 제조', isActive: true }]),
    items: ref([item(), item({ id: 'item-2', code: 'FG-MD-220', name: '모터 드라이브 220V', itemType: ITEM_TYPE.FINISHED_GOOD, safetyStock: 32, standardPrice: 480000, isActive: false })]),
    loading: ref(false),
    error: ref(null),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    createItem: vi.fn().mockResolvedValue(item({ id: 'item-3', code: 'RM-NEW-001', name: '신규 원자재' })),
    updateItem: vi.fn().mockResolvedValue(item({ name: '수정 품목' })),
    ...overrides
});

const setup = () => mount(Items, { global: { plugins: [PrimeVue], stubs: { Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/></section>' }, ConfirmDialog: true } } });
const findSelect = (wrapper, inputId) => wrapper.findAllComponents({ name: 'Select' }).find((candidate) => candidate.props('inputId') === inputId);

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

describe('item master screen', () => {
    it('loads the ledger and shows both active and inactive items with Korean type labels', async () => {
        const wrapper = setup();
        await flushPromises();

        expect(mocks.master.ensureLoaded).toHaveBeenCalled();
        expect(wrapper.text()).toContain('알루미늄 시트 2T');
        expect(wrapper.text()).toContain('원자재');
        expect(wrapper.text()).toContain('완제품');
        expect(wrapper.text()).toContain('비활성');
    });

    it('filters by type and offers to clear the filter', async () => {
        const wrapper = setup();
        await flushPromises();

        findSelect(wrapper, 'item-filter-type').vm.$emit('update:modelValue', ITEM_TYPE.FINISHED_GOOD);
        await flushPromises();
        expect(wrapper.text()).toContain('모터 드라이브 220V');
        expect(wrapper.text()).not.toContain('알루미늄 시트 2T');

        await wrapper.get('[data-testid="item-reset"]').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('알루미늄 시트 2T');
    });

    it('refuses to save an invalid draft and reports nothing to the repository', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="item-edit"]').trigger('click');
        await wrapper.get('#item-name').setValue('   ');
        await wrapper.get('#item-form').trigger('submit');
        await flushPromises();

        expect(mocks.master.updateItem).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('locks the code while editing and sends the normalized payload', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="item-edit"]').trigger('click');
        expect(wrapper.get('#item-code').attributes('disabled')).toBeDefined();
        await wrapper.get('#item-name').setValue(' 수정 품목 ');
        await wrapper.get('#item-safetyStock').setValue('1,500');
        await wrapper.get('#item-form').trigger('submit');
        await flushPromises();

        expect(mocks.master.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ code: 'RM-AL-001', name: '수정 품목', safetyStock: 1500, unit: 'EA' }));
    });

    it('asks before changing the active state', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="item-toggle"]').trigger('click');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ group: 'items', header: '품목 비활성화' }));
    });

    it('hides every write control from a non-administrator', async () => {
        mocks.auth.hasRole = vi.fn(() => false);
        const wrapper = setup();
        await flushPromises();

        expect(wrapper.find('[data-testid="item-edit"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="item-toggle"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('품목 등록 및 수정은 관리자 계정에서만');
        expect(wrapper.text()).toContain('알루미늄 시트 2T');
    });

    it('keeps the accessibility conventions the master screens share', () => {
        const markup = source();

        expect(markup.match(/<h1/g)).toHaveLength(1);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('aria-live="polite"');
        expect(markup).toContain('frozen alignFrozen="right"');
        for (const field of ['item-company', 'item-filter-type', 'item-companyId', 'item-code', 'item-name', 'item-itemType', 'item-unit', 'item-safetyStock', 'item-standardPrice']) {
            expect(markup).toContain(`for="${field}"`);
        }
    });
});
