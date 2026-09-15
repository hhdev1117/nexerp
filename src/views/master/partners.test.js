// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoMasterRepository, demoCompanies, demoPartners } from '@/repositories/master/demoMasterRepository';
import { createMasterStore } from '@/stores/master';
import Partners from './Partners.vue';

const harness = vi.hoisted(() => ({
    store: null,
    toastAdd: vi.fn(),
    confirmRequire: vi.fn(),
    profile: { role: 'admin', is_active: true }
}));

vi.mock('@/stores/master', async (importOriginal) => ({ ...(await importOriginal()), useMasterStore: () => harness.store }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ hasRole: (roles) => harness.profile.is_active && roles.includes(harness.profile.role) }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: harness.toastAdd }) }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: harness.confirmRequire }) }));

const wrappers = [];

const deferred = () => {
    let resolve;
    const promise = new Promise((next) => {
        resolve = next;
    });
    return { promise, resolve };
};

const mountScreen = async () => {
    const wrapper = mount(Partners, { attachTo: document.body, global: { plugins: [PrimeVue] } });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

const findButton = (wrapper, label) => wrapper.findAll('button').find((button) => button.text().trim() === label);

const setText = (selector, value) => {
    const input = document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const setComponentModel = async (wrapper, name, inputId, value) => {
    const component = wrapper.findAllComponents({ name }).find((candidate) => candidate.props('inputId') === inputId);
    expect(component, `${name}#${inputId}`).toBeTruthy();
    component.vm.$emit('update:modelValue', value);
    await flushPromises();
};

const submitForm = async () => {
    document.querySelector('#partner-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
};

const openCreate = async (wrapper) => {
    await findButton(wrapper, '거래처 등록').trigger('click');
    await flushPromises();
};

const fillRequiredPartner = async (wrapper, { companyId = 'company-nxm', code = 'NEW-001', name = '새 거래처', customer = true, vendor = false } = {}) => {
    await setComponentModel(wrapper, 'Select', 'partner-company', companyId);
    setText('#partner-code', code);
    setText('#partner-name', name);
    if (customer) await setComponentModel(wrapper, 'Checkbox', 'partner-isCustomer', true);
    if (vendor) await setComponentModel(wrapper, 'Checkbox', 'partner-isVendor', true);
};

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    harness.store = createMasterStore({ repository: createDemoMasterRepository() });
    harness.profile = { role: 'admin', is_active: true };
    harness.toastAdd.mockReset();
    harness.confirmRequire.mockReset();
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('partner management screen', () => {
    it('shows the first active company rows read-only to non-administrators', async () => {
        harness.profile = { role: 'user', is_active: true };
        harness.store = createMasterStore({
            repository: createDemoMasterRepository({
                companies: demoCompanies.map((company) => (company.id === 'company-nxd' ? { ...company, isActive: false } : company))
            })
        });
        const wrapper = await mountScreen();

        expect(wrapper.text()).toContain('넥서스 제조');
        expect(wrapper.text()).toContain('한빛 유통');
        expect(wrapper.text()).toContain('101-88-00001');
        expect(wrapper.text()).not.toContain('미래 상사');
        expect(wrapper.text()).toContain('관리자 계정에서만');
        expect(findButton(wrapper, '거래처 등록')).toBeUndefined();
        expect(wrapper.findAll('[aria-label$="거래처 수정"]')).toHaveLength(0);
        expect(wrapper.findAll('[aria-label$="거래처 비활성화"]')).toHaveLength(0);
    });

    it('switches companies and searches by code, name, or business number', async () => {
        const wrapper = await mountScreen();

        await setComponentModel(wrapper, 'Select', 'partner-company-filter', 'company-nxm');
        expect(wrapper.text()).toContain('한빛 유통');
        expect(wrapper.text()).toContain('대성 소재');
        expect(wrapper.text()).not.toContain('미래 상사');

        for (const query of ['CUS-001', '한빛', '101-88-00001']) {
            setText('#partner-keyword', query);
            await flushPromises();
            expect(wrapper.text()).toContain('한빛 유통');
            expect(wrapper.text()).not.toContain('대성 소재');
        }
    });

    it('combines role and status filters and explains an empty result', async () => {
        harness.store = createMasterStore({
            repository: createDemoMasterRepository({
                partners: [
                    ...demoPartners,
                    {
                        ...demoPartners[2],
                        id: 'partner-nxd-inactive',
                        code: 'OLD-001',
                        name: '휴면 고객',
                        businessNumber: '4018800004',
                        isVendor: false,
                        isActive: false
                    }
                ]
            })
        });
        const wrapper = await mountScreen();

        await setComponentModel(wrapper, 'Select', 'partner-role-filter', 'customer');
        await setComponentModel(wrapper, 'Select', 'partner-status-filter', 'inactive');
        expect(wrapper.text()).toContain('휴면 고객');
        expect(wrapper.text()).not.toContain('미래 상사');

        setText('#partner-keyword', '검색되지-않음');
        await flushPromises();
        expect(wrapper.text()).toContain('조건에 맞는 거래처가 없습니다.');
    });

    it('announces loading and provider-safe load errors', async () => {
        const repository = createDemoMasterRepository();
        repository.listPartners = vi.fn().mockRejectedValue(new Error('sentinel-provider-secret'));
        harness.store = createMasterStore({ repository });
        const wrapper = await mountScreen();

        expect(wrapper.get('[role="alert"]').text()).toContain('기준정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(wrapper.text()).not.toContain('sentinel');
    });

    it('associates every select combobox with its visible label and company error', async () => {
        const wrapper = await mountScreen();

        for (const [inputId, labelId] of [
            ['partner-company-filter', 'partner-company-filter-label'],
            ['partner-role-filter', 'partner-role-filter-label'],
            ['partner-status-filter', 'partner-status-filter-label']
        ]) {
            const combobox = document.querySelector(`#${inputId}[role="combobox"]`);
            expect(combobox).not.toBeNull();
            expect(combobox.getAttribute('aria-labelledby')).toBe(labelId);
            expect(document.getElementById(labelId)?.textContent.trim()).not.toBe('');
        }

        await openCreate(wrapper);
        await submitForm();

        const company = document.querySelector('#partner-company[role="combobox"]');
        expect(company.getAttribute('aria-labelledby')).toBe('partner-company-label');
        expect(company.getAttribute('aria-describedby')).toBe('partner-company-error');
        expect(company.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById('partner-company-error')?.textContent).toContain('회사를 선택해 주세요.');
    });

    it('shows every validation message and focuses the company field', async () => {
        const wrapper = await mountScreen();
        await openCreate(wrapper);
        setText('#partner-businessNumber', '12-34');
        setText('#partner-email', 'billing @example.com');

        await submitForm();

        expect(document.body.textContent).toContain('회사를 선택해 주세요.');
        expect(document.body.textContent).toContain('코드는 영문 대문자, 숫자, 하이픈으로 2자 이상 20자 이하여야 합니다.');
        expect(document.body.textContent).toContain('거래처명을 입력해 주세요.');
        expect(document.body.textContent).toContain('고객 또는 공급업체 역할을 하나 이상 선택해 주세요.');
        expect(document.body.textContent).toContain('사업자등록번호는 숫자 10자리여야 합니다.');
        expect(document.body.textContent).toContain('올바른 이메일 주소를 입력해 주세요.');
        expect(document.activeElement?.id).toBe('partner-company');
        expect(harness.store.partners.value).toHaveLength(3);
        expect(harness.toastAdd).not.toHaveBeenCalled();
    });

    it('creates a normalized dual-role partner with camel-case fields', async () => {
        const createPartner = vi.spyOn(harness.store, 'createPartner');
        const wrapper = await mountScreen();
        await openCreate(wrapper);
        await fillRequiredPartner(wrapper, { code: ' new-002 ', name: ' 새 거래처 ', customer: true, vendor: true });
        setText('#partner-businessNumber', '123-45-67890');
        setText('#partner-representative', ' 홍길동 ');
        setText('#partner-email', ' contact@example.com ');
        setText('#partner-phone', ' 02-1234-5678 ');
        setText('#partner-address', ' 서울특별시 ');

        await submitForm();

        expect(createPartner).toHaveBeenCalledWith({
            companyId: 'company-nxm',
            code: 'NEW-002',
            name: '새 거래처',
            businessNumber: '1234567890',
            isCustomer: true,
            isVendor: true,
            representative: '홍길동',
            email: 'contact@example.com',
            phone: '02-1234-5678',
            address: '서울특별시',
            isActive: true
        });
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '거래처 등록 완료' }));
        expect(document.querySelector('#partner-form')).toBeNull();
    });

    it('edits a partner and confirms deactivation and reactivation', async () => {
        const updatePartner = vi.spyOn(harness.store, 'updatePartner');
        harness.confirmRequire.mockImplementation((options) => options.accept());
        const wrapper = await mountScreen();

        await wrapper.find('[aria-label="미래 상사 거래처 수정"]').trigger('click');
        await flushPromises();
        expect(document.querySelector('#partner-isActive')).toBeNull();
        expect(document.querySelector('#partner-code').disabled).toBe(true);
        setText('#partner-name', ' 미래 종합상사 ');
        await submitForm();

        expect(updatePartner).toHaveBeenCalledWith('partner-nxd-dual', {
            companyId: 'company-nxd',
            name: '미래 종합상사',
            businessNumber: '3018800003',
            isCustomer: true,
            isVendor: true,
            representative: '정지훈',
            email: 'office@mirae.example',
            phone: '051-333-4444',
            address: '부산광역시 강서구'
        });
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '거래처 수정 완료' }));

        await wrapper.find('[aria-label="미래 종합상사 거래처 비활성화"]').trigger('click');
        await flushPromises();
        expect(harness.confirmRequire).toHaveBeenLastCalledWith(expect.objectContaining({ header: '거래처 비활성화' }));
        expect(updatePartner).toHaveBeenCalledWith('partner-nxd-dual', { isActive: false });

        await wrapper.find('[aria-label="미래 종합상사 거래처 활성화"]').trigger('click');
        await flushPromises();
        expect(harness.confirmRequire).toHaveBeenLastCalledWith(expect.objectContaining({ header: '거래처 활성화' }));
        expect(updatePartner).toHaveBeenCalledWith('partner-nxd-dual', { isActive: true });
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '상태 변경 완료' }));
    });

    it('does not change partner status until confirmation is accepted', async () => {
        const updatePartner = vi.spyOn(harness.store, 'updatePartner');
        let confirmation;
        harness.confirmRequire.mockImplementation((options) => {
            confirmation = options;
        });
        const wrapper = await mountScreen();

        await wrapper.find('[aria-label="미래 상사 거래처 비활성화"]').trigger('click');
        await flushPromises();

        expect(confirmation).toEqual(expect.objectContaining({ header: '거래처 비활성화' }));
        expect(updatePartner).not.toHaveBeenCalled();

        await confirmation.accept();
        await flushPromises();

        expect(updatePartner).toHaveBeenCalledOnce();
        expect(updatePartner).toHaveBeenCalledWith('partner-nxd-dual', { isActive: false });
    });

    it('keeps a pending save bound to its original dialog and blocks competing actions', async () => {
        const pending = deferred();
        const createPartner = vi.spyOn(harness.store, 'createPartner').mockReturnValueOnce(pending.promise);
        const updatePartner = vi.spyOn(harness.store, 'updatePartner');
        const wrapper = await mountScreen();
        await openCreate(wrapper);
        await fillRequiredPartner(wrapper);

        await submitForm();

        const dialog = wrapper.findComponent({ name: 'Dialog' });
        expect(dialog.props('header')).toBe('거래처 등록');
        expect(dialog.props('closable')).toBe(false);
        expect(dialog.props('closeOnEscape')).toBe(false);
        expect(dialog.props('dismissableMask')).toBe(false);
        expect(document.querySelector('#partner-form')?.getAttribute('aria-busy')).toBe('true');
        expect(findButton(wrapper, '거래처 등록').attributes('disabled')).toBeDefined();

        const edit = wrapper.find('[aria-label="미래 상사 거래처 수정"]');
        const status = wrapper.find('[aria-label="미래 상사 거래처 비활성화"]');
        expect(edit.attributes('disabled')).toBeDefined();
        expect(status.attributes('disabled')).toBeDefined();
        await submitForm();
        await edit.trigger('click');
        await status.trigger('click');
        expect(createPartner).toHaveBeenCalledTimes(1);
        expect(document.querySelector('#partner-code').value).toBe('NEW-001');
        expect(harness.confirmRequire).not.toHaveBeenCalled();

        pending.resolve({
            id: 'partner-new',
            companyId: 'company-nxm',
            code: 'NEW-001',
            name: '새 거래처',
            isActive: true
        });
        await flushPromises();

        expect(document.querySelector('#partner-form')).toBeNull();
        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: '거래처 등록 완료', detail: '새 거래처 거래처 정보가 저장되었습니다.' }));
        expect(updatePartner).not.toHaveBeenCalled();
    });

    it('shows repository-safe save errors and retains the form for correction', async () => {
        vi.spyOn(harness.store, 'createPartner').mockRejectedValueOnce(Object.assign(new Error('provider details'), { code: 'duplicate_business_number' }));
        const wrapper = await mountScreen();
        await openCreate(wrapper);
        await fillRequiredPartner(wrapper);

        await submitForm();

        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: '거래처 저장 실패', detail: '이미 사용 중인 사업자등록번호입니다.' }));
        expect(document.querySelector('#partner-form')).not.toBeNull();
        expect(document.body.textContent).not.toContain('provider details');
    });

    it('shows repository-safe status errors without changing the row', async () => {
        vi.spyOn(harness.store, 'updatePartner').mockRejectedValueOnce(Object.assign(new Error('database details'), { code: 'admin_required' }));
        harness.confirmRequire.mockImplementation((options) => options.accept());
        const wrapper = await mountScreen();

        await wrapper.find('[aria-label="미래 상사 거래처 비활성화"]').trigger('click');
        await flushPromises();

        expect(harness.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: '상태 변경 실패', detail: '관리자 권한이 필요합니다.' }));
        expect(wrapper.find('[aria-label="미래 상사 거래처 비활성화"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('database details');
    });
});
