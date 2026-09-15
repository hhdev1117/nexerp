// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoMasterRepository } from '@/repositories/master/demoMasterRepository';
import { createMasterStore } from '@/stores/master';
import CompanySites from './CompanySites.vue';

const harness = vi.hoisted(() => ({
    store: null,
    runtime: null,
    toastAdd: vi.fn(),
    confirmRequire: vi.fn(),
    profile: { role: 'admin', is_active: true }
}));

vi.mock('@/stores/master', async (importOriginal) => ({ ...(await importOriginal()), useMasterStore: () => harness.store }));
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => harness.runtime }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ hasRole: (roles) => harness.profile.is_active && roles.includes(harness.profile.role) }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: harness.toastAdd }) }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: harness.confirmRequire }) }));

const wrappers = [];

const mountScreen = async () => {
    const wrapper = mount(CompanySites, { attachTo: document.body, global: { plugins: [PrimeVue] } });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

const findButton = (wrapper, label) => wrapper.findAll('button').find((button) => button.text() === label);

const setValue = (selector, value) => {
    const input = document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const submitForm = async (selector) => {
    document.querySelector(selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
};

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    harness.store = createMasterStore({ repository: createDemoMasterRepository() });
    harness.profile = { role: 'admin', is_active: true };
    harness.runtime = {
        context: ref({ mode: 'legacy' }),
        loading: ref(false),
        error: ref(null),
        canCompanyAction: (action) => harness.runtime.context.value?.companyActions?.includes(action),
        canSiteAction: (id, action) => harness.runtime.context.value?.siteActions?.some((site) => site.id === id && site.actions.includes(action))
    };
    harness.toastAdd.mockReset();
    harness.confirmRequire.mockReset();
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('company and site management screen', () => {
    it('shows registered companies read-only to non-administrators', async () => {
        harness.profile = { role: 'user', is_active: true };
        const wrapper = await mountScreen();

        expect(wrapper.text()).toContain('넥서스 제조');
        expect(wrapper.text()).toContain('넥서스 유통');
        expect(wrapper.text()).toContain('120-88-12345');
        expect(wrapper.text()).toContain('관리자 계정에서만');
        expect(findButton(wrapper, '회사 등록')).toBeUndefined();
        expect(wrapper.findAll('[aria-label$="회사 수정"]')).toHaveLength(0);
        expect(wrapper.findAll('[aria-label$="사업장 수정"]')).toHaveLength(0);
    });

    it('lists the sites of the selected company and follows row selection', async () => {
        const wrapper = await mountScreen();

        expect(wrapper.text()).toContain('넥서스 유통 소속 사업장입니다.');
        expect(wrapper.text()).toContain('부산 물류센터');
        expect(wrapper.text()).not.toContain('인천 공장');

        const row = wrapper.findAll('tr').find((candidate) => candidate.text().includes('NXM'));
        await row.trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('넥서스 제조 소속 사업장입니다.');
        expect(wrapper.text()).toContain('인천 공장');
        expect(wrapper.text()).toContain('서울 본사');
        expect(wrapper.text()).not.toContain('부산 물류센터');
    });

    it('validates the company form before saving and focuses the first invalid field', async () => {
        const wrapper = await mountScreen();
        await findButton(wrapper, '회사 등록').trigger('click');
        await flushPromises();

        await submitForm('#company-form');

        expect(document.body.textContent).toContain('회사명을 입력해 주세요.');
        expect(document.activeElement?.id).toBe('company-code');
        expect(harness.store.companies.value).toHaveLength(2);
        expect(harness.toastAdd).not.toHaveBeenCalled();
    });

    it('registers a company with a normalized code and selects it', async () => {
        const wrapper = await mountScreen();
        await findButton(wrapper, '회사 등록').trigger('click');
        await flushPromises();

        setValue('#company-code', 'nxt');
        setValue('#company-name', '넥서스 테크');
        setValue('#company-businessNumber', '301-88-00001');
        await submitForm('#company-form');

        const created = harness.store.companies.value.find((company) => company.code === 'NXT');
        expect(created).toMatchObject({ name: '넥서스 테크', businessNumber: '3018800001', isActive: true });
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '회사 등록 완료' }));
        expect(document.querySelector('#company-form')).toBeNull();
        expect(wrapper.text()).toContain('넥서스 테크 소속 사업장입니다.');
    });

    it('registers a site under the selected company', async () => {
        const wrapper = await mountScreen();
        await findButton(wrapper, '사업장 등록').trigger('click');
        await flushPromises();

        setValue('#site-code', 'gj');
        setValue('#site-name', '광주 지점');
        await submitForm('#site-form');

        expect(harness.store.sitesFor('company-nxd').map((site) => site.code)).toEqual(['BSN', 'GJ']);
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '사업장 등록 완료' }));
        expect(wrapper.text()).toContain('광주 지점');
    });

    it('deactivates a company after confirmation and shows the cascade', async () => {
        harness.confirmRequire.mockImplementation((options) => options.accept());
        const wrapper = await mountScreen();

        await wrapper.find('[aria-label="넥서스 제조 회사 비활성화"]').trigger('click');
        await flushPromises();

        expect(harness.confirmRequire).toHaveBeenCalledWith(expect.objectContaining({ header: '회사 비활성화' }));
        expect(harness.store.companyById('company-nxm').isActive).toBe(false);
        expect(harness.store.sitesFor('company-nxm').every((site) => !site.isActive)).toBe(true);
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '상태 변경 완료' }));
    });

    it('surfaces repository errors as Korean toasts and keeps the form open', async () => {
        const wrapper = await mountScreen();
        await findButton(wrapper, '회사 등록').trigger('click');
        await flushPromises();

        setValue('#company-code', 'NXM');
        setValue('#company-name', '중복 회사');
        await submitForm('#company-form');

        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: '이미 사용 중인 코드입니다.' }));
        expect(document.querySelector('#company-form')).not.toBeNull();
        expect(harness.store.companies.value).toHaveLength(2);
    });
});

const activate = (actions = [], siteActions = []) => {
    harness.profile = { role: 'user', is_active: true };
    harness.runtime.context.value = { mode: 'active', companyId: 'company-nxm', companies: [{ id: 'company-nxm', name: '넥서스 제조' }], menuKeys: ['company'], revision: 1, companyActions: actions, siteActions };
};
describe('published company access', () => {
    it('isolates company rows and permits a nonadmin granted update', async () => {
        activate(['read', 'update']);
        const wrapper = await mountScreen();
        expect(wrapper.text()).not.toContain('넥서스 유통');
        expect(wrapper.text()).toContain('넥서스 제조 소속 사업장입니다.');
        expect(wrapper.findAll('[aria-label$="회사 수정"]')).toHaveLength(1);
        expect(findButton(wrapper, '회사 등록')).toBeUndefined();
        expect(findButton(wrapper, '사업장 등록')).toBeUndefined();
        await wrapper.find('[aria-label="넥서스 제조 회사 수정"]').trigger('click');
        await flushPromises();
        setValue('#company-name', '수정된 제조');
        await submitForm('#company-form');
        expect(harness.store.companyById('company-nxm').name).toBe('수정된 제조');
    });
    it('blocks direct handlers and hides cached rows when context is revoked', async () => {
        activate();
        const wrapper = await mountScreen();
        const vm = wrapper.vm.$.setupState;
        vm.openEditCompany(harness.store.companyById('company-nxm'));
        vm.toggleCompanyActive(harness.store.companyById('company-nxm'));
        vm.openCreateSite();
        await flushPromises();
        expect(document.querySelector('#company-form')).toBeNull();
        expect(document.querySelector('#site-form')).toBeNull();
        expect(harness.confirmRequire).not.toHaveBeenCalled();
        harness.runtime.context.value = null;
        await flushPromises();
        expect(wrapper.text()).not.toContain('넥서스 제조');
        expect(wrapper.text()).not.toContain('인천 공장');
    });
    it('rechecks permission before accepting an earlier confirmation', async () => {
        activate(['update']);
        const wrapper = await mountScreen();
        wrapper.vm.$.setupState.toggleCompanyActive(harness.store.companyById('company-nxm'));
        const confirmation = harness.confirmRequire.mock.calls[0][0];
        harness.runtime.context.value = null;
        await confirmation.accept();
        expect(harness.store.companyById('company-nxm').isActive).toBe(true);
    });
});

describe('site grants and company switching', () => {
    it('allows only the individually granted site update and rejects a changed destination company', async () => {
        activate(['read', 'create'], [{ id: 'site-nxm-icn', actions: ['read', 'update'] }]);
        const wrapper = await mountScreen();
        expect(wrapper.findAll('[aria-label$="사업장 수정"]')).toHaveLength(1);
        expect(wrapper.find('[aria-label="인천 공장 사업장 수정"]').exists()).toBe(true);
        const vm = wrapper.vm.$.setupState;
        vm.openEditSite(harness.store.sitesFor('company-nxm').find((site) => site.code === 'HQ'));
        await flushPromises();
        expect(document.querySelector('#site-form')).toBeNull();
        await wrapper.find('[aria-label="인천 공장 사업장 수정"]').trigger('click');
        await flushPromises();
        vm.siteDraft.companyId = 'company-nxd';
        await submitForm('#site-form');
        expect(harness.store.sitesFor('company-nxd')).toHaveLength(1);
        vm.siteDraft.companyId = 'company-nxm';
        setValue('#site-name', '수정 공장');
        await submitForm('#site-form');
        expect(harness.store.sitesFor('company-nxm').find((site) => site.code === 'ICN').name).toBe('수정 공장');
        await findButton(wrapper, '사업장 등록').trigger('click');
        await flushPromises();
        setValue('#site-code', 'NEW');
        setValue('#site-name', '새 사업장');
        await submitForm('#site-form');
        expect(harness.store.sitesFor('company-nxm')).toHaveLength(3);
    });
    it('closes drafts and follows the globally selected company after fresh data loads', async () => {
        activate(['update']);
        const wrapper = await mountScreen();
        await wrapper.find('[aria-label="넥서스 제조 회사 수정"]').trigger('click');
        harness.runtime.context.value = { ...harness.runtime.context.value, companyId: 'company-nxd' };
        await flushPromises();
        expect(document.querySelector('#company-form')).toBeNull();
        expect(wrapper.text()).not.toContain('넥서스 제조');
        expect(wrapper.text()).toContain('넥서스 유통 소속 사업장입니다.');
    });
});

it('shows and updates a scoped site even when RLS hides full company rows', async () => {
    activate([], [{ id: 'site-nxm-icn', actions: ['read', 'update'] }]);
    const repository = createDemoMasterRepository();
    repository.listCompanies = async () => [];
    const listSites = repository.listSites;
    repository.listSites = async () => (await listSites()).filter((site) => site.id === 'site-nxm-icn');
    harness.store = createMasterStore({ repository });
    const wrapper = await mountScreen();
    expect(wrapper.text()).toContain('넥서스 제조 소속 사업장입니다.');
    expect(wrapper.text()).toContain('인천 공장');
    expect(wrapper.text()).not.toContain('120-88-12345');
    expect(wrapper.findAll('[aria-label$="회사 수정"]')).toHaveLength(0);
    await wrapper.find('[aria-label="인천 공장 사업장 수정"]').trigger('click');
    await flushPromises();
    setValue('#site-name', '권한 내 수정');
    await submitForm('#site-form');
    expect(harness.store.sites.value[0].name).toBe('권한 내 수정');
    harness.runtime.context.value = null;
    await flushPromises();
    expect(wrapper.text()).not.toContain('권한 내 수정');
    expect(wrapper.text()).not.toContain('넥서스 제조');
});
