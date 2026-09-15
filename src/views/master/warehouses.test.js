// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { WAREHOUSE_TYPE } from '@/data/master';
import Warehouses from './Warehouses.vue';

const mocks = vi.hoisted(() => ({}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/master', () => ({ useMasterStore: () => mocks.master }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: mocks.confirm }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: mocks.toast }) }));

const sourcePath = resolve(process.cwd(), 'src/views/master/Warehouses.vue');
const source = () => (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '');

const warehouse = (overrides = {}) => ({ id: 'warehouse-1', companyId: 'company-1', siteId: 'site-1', code: 'WH-ICN-RM', name: '인천 원자재창고', warehouseType: WAREHOUSE_TYPE.RAW_MATERIAL, isActive: true, ...overrides });

const masterStore = (overrides = {}) => ({
    companies: ref([
        { id: 'company-1', code: 'NXM', name: '넥서스 제조', isActive: true },
        { id: 'company-2', code: 'NXD', name: '넥서스 유통', isActive: true }
    ]),
    sites: ref([
        { id: 'site-1', companyId: 'company-1', code: 'ICN', name: '인천 공장', isActive: true },
        { id: 'site-2', companyId: 'company-2', code: 'BSN', name: '부산 물류센터', isActive: true }
    ]),
    warehouses: ref([warehouse(), warehouse({ id: 'warehouse-2', companyId: 'company-2', siteId: 'site-2', code: 'WH-BSN-FG', name: '부산 완제품창고', warehouseType: WAREHOUSE_TYPE.FINISHED_GOOD, isActive: false })]),
    loading: ref(false),
    error: ref(null),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    createWarehouse: vi.fn().mockResolvedValue(warehouse({ id: 'warehouse-3', code: 'WH-NEW' })),
    updateWarehouse: vi.fn().mockResolvedValue(warehouse({ name: '수정 창고' })),
    ...overrides
});

const setup = () => mount(Warehouses, { global: { plugins: [PrimeVue], stubs: { Dialog: { props: ['visible'], template: '<section v-if="visible"><slot/></section>' }, ConfirmDialog: true } } });
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

describe('warehouse master screen', () => {
    it('scopes the list to the selected company and resolves the site name', async () => {
        const wrapper = setup();
        await flushPromises();

        expect(mocks.master.ensureLoaded).toHaveBeenCalled();
        expect(wrapper.text()).toContain('인천 원자재창고');
        expect(wrapper.text()).toContain('ICN · 인천 공장');
        expect(wrapper.text()).not.toContain('부산 완제품창고');

        findSelect(wrapper, 'warehouse-company').vm.$emit('update:modelValue', 'company-2');
        await flushPromises();
        expect(wrapper.text()).toContain('부산 완제품창고');
        expect(wrapper.text()).toContain('비활성');
    });

    it('offers only the sites of the company chosen in the dialog and clears a stale site', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="warehouse-edit"]').trigger('click');
        expect(optionValues(wrapper, 'warehouse-siteId')).toEqual(['site-1']);

        findSelect(wrapper, 'warehouse-companyId').vm.$emit('update:modelValue', 'company-2');
        await flushPromises();
        expect(optionValues(wrapper, 'warehouse-siteId')).toEqual(['site-2']);
        expect(findSelect(wrapper, 'warehouse-siteId').props('modelValue')).toBe('');
    });

    it('refuses to save without a site and reports nothing to the repository', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="warehouse-edit"]').trigger('click');
        findSelect(wrapper, 'warehouse-siteId').vm.$emit('update:modelValue', '');
        await flushPromises();
        await wrapper.get('#warehouse-form').trigger('submit');
        await flushPromises();

        expect(mocks.master.updateWarehouse).not.toHaveBeenCalled();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('locks the code while editing and sends the normalized payload', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="warehouse-edit"]').trigger('click');
        expect(wrapper.get('#warehouse-code').attributes('disabled')).toBeDefined();
        await wrapper.get('#warehouse-name').setValue(' 수정 창고 ');
        await wrapper.get('#warehouse-form').trigger('submit');
        await flushPromises();

        expect(mocks.master.updateWarehouse).toHaveBeenCalledWith('warehouse-1', expect.objectContaining({ code: 'WH-ICN-RM', name: '수정 창고', siteId: 'site-1' }));
    });

    it('warns that an inactive site blocks reactivation before changing the state', async () => {
        const wrapper = setup();
        await flushPromises();

        await wrapper.get('[data-testid="warehouse-toggle"]').trigger('click');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ group: 'warehouses', header: '창고 비활성화' }));
    });

    it('hides every write control from a non-administrator', async () => {
        mocks.auth.hasRole = vi.fn(() => false);
        const wrapper = setup();
        await flushPromises();

        expect(wrapper.find('[data-testid="warehouse-edit"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('창고 등록 및 수정은 관리자 계정에서만');
        expect(wrapper.text()).toContain('인천 원자재창고');
    });

    it('keeps the accessibility conventions the master screens share', () => {
        const markup = source();

        expect(markup.match(/<h1/g)).toHaveLength(1);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('aria-live="polite"');
        expect(markup).toContain('frozen alignFrozen="right"');
        for (const field of ['warehouse-company', 'warehouse-companyId', 'warehouse-siteId', 'warehouse-code', 'warehouse-name', 'warehouse-warehouseType']) {
            expect(markup).toContain(`for="${field}"`);
        }
    });
});
