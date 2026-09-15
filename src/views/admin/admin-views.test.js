// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { erpMenu, flattenMenuRoutes } from '@/data/erp';
import { accountCreatePayload, accountUpdatePayload, buildPermissionGroups, createAccountDraft, createEditAccountDraft, permissionKeysEqual, validateAccountDraft, validatePasswordResetDraft } from './adminModels';
import SecuritySettings from './SecuritySettings.vue';
import AccountManagement from './AccountManagement.vue';

const confirmRequire = vi.hoisted(() => vi.fn());
const toastAdd = vi.hoisted(() => vi.fn());
const adminApi = vi.hoisted(() => ({
    listAccounts: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    resetAccountPassword: vi.fn(),
    resetAccountMfa: vi.fn(),
    updateAccountStatus: vi.fn()
}));
const securityAuthStore = {
    user: ref({ id: 'admin-1' }),
    loading: ref(false),
    mfaStatus: ref('ready'),
    mfaSatisfied: ref(true),
    mfaEnrollment: ref(null),
    mfaFactors: ref([]),
    refreshMfaState: vi.fn(),
    beginTotpEnrollment: vi.fn(),
    verifyTotpEnrollment: vi.fn(),
    cancelTotpEnrollment: vi.fn(),
    unenrollTotp: vi.fn()
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => securityAuthStore }));
vi.mock('@/services/adminApi', () => ({ useAdminApi: () => adminApi }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: confirmRequire }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

const source = (file) => {
    const path = fileURLToPath(new URL(file, import.meta.url));
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const accountsSource = source('./AccountManagement.vue');
const permissionsSource = source('./MenuPermissionManagement.vue');
const infrastructureSource = source('./InfrastructureUsage.vue');
const securitySource = source('./SecuritySettings.vue');

const existingAccount = {
    id: 'admin-1',
    loginId: 'admin01',
    displayName: '시스템 관리자',
    department: '시스템 관리',
    role: 'admin',
    isActive: true
};

const mountedAccounts = [];
const mountAccounts = async (rows = [existingAccount]) => {
    adminApi.listAccounts.mockResolvedValueOnce(rows);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
    await router.push('/');
    await router.isReady();
    const wrapper = mount(AccountManagement, { attachTo: document.body, global: { plugins: [PrimeVue, router], stubs: { ConfirmDialog: true } } });
    mountedAccounts.push(wrapper);
    await flushPromises();
    return wrapper;
};

const setInput = async (selector, value) => {
    const input = document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
};

const fillCreateForm = async () => {
    await setInput('#account-loginId', 'staff01');
    await setInput('#account-temporaryPassword', 'Temporary-9!');
    await setInput('#account-displayName', '김서준');
    await setInput('#account-department', '영업팀');
};

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
    adminApi.listAccounts.mockReset();
    adminApi.createAccount.mockReset();
    toastAdd.mockReset();
});

afterEach(() => {
    while (mountedAccounts.length) mountedAccounts.pop().unmount();
    document.body.innerHTML = '';
});

describe('administrator account screen', () => {
    it('renders account login IDs and filters the mounted table by login ID', async () => {
        const wrapper = await mountAccounts([existingAccount, { ...existingAccount, id: 'staff-1', loginId: 'staff01', displayName: '김서준' }]);

        expect(wrapper.text()).toContain('staff01');
        await wrapper.get('[aria-label="계정 검색"]').setValue('staff01');
        await flushPromises();

        expect(wrapper.text()).toContain('staff01');
        expect(wrapper.text()).not.toContain('admin01');
    });

    it('submits loginId through the mounted create flow and renders the created account', async () => {
        adminApi.createAccount.mockResolvedValueOnce({ ...existingAccount, id: 'staff-1', loginId: 'staff01', displayName: '김서준', department: '영업팀', role: 'user' });
        const wrapper = await mountAccounts([]);
        await wrapper.findAll('button').find((button) => button.text().includes('새 계정')).trigger('click');
        await flushPromises();
        await fillCreateForm();

        document.querySelector('#account-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(adminApi.createAccount).toHaveBeenCalledWith({ loginId: 'staff01', temporaryPassword: 'Temporary-9!', displayName: '김서준', department: '영업팀', role: 'user' });
        expect(wrapper.text()).toContain('staff01');
    });

    it('shows a normalized duplicate-login-ID message from the mounted create flow', async () => {
        adminApi.createAccount.mockRejectedValueOnce(Object.assign(new Error('provider detail'), { code: 'login_id_exists' }));
        const wrapper = await mountAccounts([]);
        await wrapper.findAll('button').find((button) => button.text().includes('새 계정')).trigger('click');
        await flushPromises();
        await fillCreateForm();

        document.querySelector('#account-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: '계정 등록 실패', detail: '이미 사용 중인 아이디입니다.' }));
    });

    it('keeps login and account interactive targets at least 44px on mobile', () => {
        const authStylesSource = source('../../assets/layout/_auth.scss');
        expect(authStylesSource).toMatch(/@media \(max-width: 575px\)[\s\S]*\.auth-panel \.p-inputtext,[\s\S]*\.auth-panel \.p-button[\s\S]*min-height:\s*2\.75rem/);
        expect(authStylesSource).toMatch(/@media \(max-width: 575px\)[\s\S]*\.auth-panel \.p-button\s*\{[\s\S]*min-width:\s*2\.75rem/);
        expect(accountsSource).toMatch(/@media \(max-width: 640px\)[\s\S]*:deep\(\.p-inputtext\),[\s\S]*:deep\(\.p-select\),[\s\S]*:deep\(\.p-button\)[\s\S]*min-height:\s*2\.75rem/);
        expect(accountsSource).toMatch(/@media \(max-width: 640px\)[\s\S]*:deep\(\.p-button\)\s*\{[\s\S]*min-width:\s*2\.75rem/);
        expect(accountsSource).toMatch(/@media \(max-width: 640px\)[\s\S]*:deep\(\.p-toggleswitch\)\s*\{[\s\S]*min-width:\s*2\.75rem;[\s\S]*min-height:\s*2\.75rem/);
    });

    it('validates every required create field before submitting', () => {
        expect(validateAccountDraft(createAccountDraft(), 'create')).toEqual({
            loginId: '아이디는 영문 소문자와 숫자 4~20자로 입력해 주세요.',
            temporaryPassword: '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.',
            displayName: '이름을 입력해 주세요.',
            department: '부서를 입력해 주세요.'
        });

        expect(
            validateAccountDraft(
                {
                    loginId: 'employee01',
                    temporaryPassword: 'Temporary-9!',
                    displayName: ' 김서준 ',
                    department: ' 영업팀 ',
                    role: 'user',
                    isActive: true
                },
                'create'
            )
        ).toEqual({});
    });

    it('keeps temporary credentials out of edit state and update payloads', () => {
        const draft = createEditAccountDraft(existingAccount);

        expect(draft).toEqual({ displayName: '시스템 관리자', department: '시스템 관리', role: 'admin', isActive: true });
        expect(draft).not.toHaveProperty('temporaryPassword');
        expect(accountUpdatePayload({ ...draft, temporaryPassword: 'must-not-persist' })).toEqual(draft);
    });

    it('normalizes a create payload without retaining form-only state', () => {
        expect(
            accountCreatePayload({
                loginId: 'employee01',
                temporaryPassword: 'Temporary-9!',
                displayName: ' 김서준 ',
                department: ' 영업팀 ',
                role: 'user',
                isActive: false,
                submitted: true
            })
        ).toEqual({
            loginId: 'employee01',
            temporaryPassword: 'Temporary-9!',
            displayName: '김서준',
            department: '영업팀',
            role: 'user'
        });
    });

    it('accepts only exact lowercase login IDs for account provisioning', () => {
        expect(validateAccountDraft({ loginId: 'admin01', temporaryPassword: 'Temporary-9!', displayName: '김서준', department: '영업팀' }, 'create')).toEqual({});
        for (const loginId of ['Admin01', 'abc', 'admin_01', 'admin 01']) {
            expect(validateAccountDraft({ loginId, temporaryPassword: 'Temporary-9!', displayName: '김서준', department: '영업팀' }, 'create')).toEqual({ loginId: '아이디는 영문 소문자와 숫자 4~20자로 입력해 주세요.' });
        }
    });

    it('uses login IDs in account search, list display, and duplicate errors without exposing internal emails', () => {
        expect(accountsSource).toContain('[account.loginId, account.displayName, account.department]');
        expect(accountsSource).toContain('{{ slotProps.data.loginId }}');
        expect(accountsSource).toContain('이미 사용 중인 아이디입니다.');
        expect(accountsSource).not.toContain('@nexerp.internal');
    });

    it('validates reset passwords by total length, non-whitespace content, and confirmation', () => {
        expect(validatePasswordResetDraft({ temporaryPassword: '', confirmation: '' })).toEqual({
            temporaryPassword: '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.',
            confirmation: '임시 비밀번호 확인을 입력해 주세요.'
        });
        expect(validatePasswordResetDraft({ temporaryPassword: '        ', confirmation: '        ' })).toEqual({
            temporaryPassword: '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.',
            confirmation: '임시 비밀번호 확인을 입력해 주세요.'
        });
        expect(validatePasswordResetDraft({ temporaryPassword: 'x'.repeat(129), confirmation: 'x'.repeat(129) })).toEqual({
            temporaryPassword: '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.'
        });
        expect(validatePasswordResetDraft({ temporaryPassword: 'Replacement-Password-2!', confirmation: 'different-password' })).toEqual({
            confirmation: '임시 비밀번호가 일치하지 않습니다.'
        });
        expect(validatePasswordResetDraft({ temporaryPassword: 'Replacement-Password-2!', confirmation: 'Replacement-Password-2!' })).toEqual({});
    });

    it('loads, creates, edits, and protects the current administrator in the real view', () => {
        expect(accountsSource).toContain('await adminApi.listAccounts()');
        expect(accountsSource).toContain('await adminApi.createAccount(accountCreatePayload(draft.value))');
        expect(accountsSource).toContain('await adminApi.updateAccount(editingAccount.value.id, accountUpdatePayload(draft.value))');
        expect(accountsSource).toContain("const isCurrentAccount = (account) => typeof account?.id === 'string' && account.id.toLowerCase() === authStore.user.value?.id?.toLowerCase()");
        expect(accountsSource).toContain(':disabled="isEditingCurrentAccount"');
        expect(accountsSource).toContain('type="password"');
        expect(accountsSource).toContain("draft.value.temporaryPassword = ''");
        expect(accountsSource).not.toContain('localStorage');
        expect(accountsSource).not.toContain('sessionStorage');
    });

    it('provides normalized loading, empty, retry, confirmation, and error states', () => {
        expect(accountsSource).toContain('계정 정보를 불러오는 중입니다.');
        expect(accountsSource).toContain('등록된 계정이 없습니다.');
        expect(accountsSource).toContain('계정 목록 다시 불러오기');
        expect(accountsSource).toContain('confirm.require({');
        expect(accountsSource).toContain("severity: 'error'");
        expect(accountsSource).not.toContain('error.message');
        expect(accountsSource).toContain('responsiveLayout="scroll"');
        expect(accountsSource).toContain('min-w-0');
    });

    it('provides explicit password-reset and ERP lock actions without allowing self-service', () => {
        expect(accountsSource).toContain('icon="pi pi-key"');
        expect(accountsSource).toContain("slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'");
        expect(accountsSource).toContain(':disabled="isCurrentAccount(slotProps.data)');
        expect(accountsSource).toContain('await adminApi.resetAccountPassword(passwordResetAccount.value.id, passwordResetDraft.value.temporaryPassword)');
        expect(accountsSource).toContain("header: locking ? 'ERP 계정 잠금' : '계정 활성화'");
        expect(accountsSource).toContain('adminApi.updateAccountStatus(account.id, !account.isActive)');
        expect(accountsSource).toContain('account.id === updated.id ? updated : account');
        expect(accountsSource).toContain("passwordResetDraft.value = { temporaryPassword: '', confirmation: '' }");
        expect(accountsSource).toContain(':title="passwordResetActionLabel(slotProps.data)"');
        expect(accountsSource).toContain(':title="statusActionLabel(slotProps.data)"');
    });

    it('provides an explicit, self-protected MFA reset action without exposing factors', () => {
        expect(accountsSource).toContain('await adminApi.resetAccountMfa(account.id)');
        expect(accountsSource).toContain("header: '인증 앱 초기화'");
        expect(accountsSource).toContain('인증 앱을 초기화');
        expect(accountsSource).toContain('pi pi-shield');
        expect(accountsSource).toContain(':aria-label="mfaResetActionLabel(slotProps.data)"');
        expect(accountsSource).toContain(':disabled="isCurrentAccount(slotProps.data) || resettingMfa"');
        expect(accountsSource).not.toContain('factorId');
    });
});

describe('security settings screen', () => {
    it('confirms backup-factor deletion and never persists enrollment material', async () => {
        securityAuthStore.loading.value = false;
        securityAuthStore.mfaStatus.value = 'ready';
        securityAuthStore.mfaSatisfied.value = true;
        securityAuthStore.mfaEnrollment.value = null;
        securityAuthStore.mfaFactors.value = [
            { id: 'factor-primary', friendly_name: 'Primary authenticator' },
            { id: 'factor-backup', friendly_name: 'Backup authenticator' }
        ];
        securityAuthStore.refreshMfaState.mockReset().mockResolvedValue({ status: 'ready' });
        securityAuthStore.unenrollTotp.mockReset().mockResolvedValue({ status: 'ready' });
        confirmRequire.mockReset();
        const wrapper = mount(SecuritySettings, {
            global: { plugins: [PrimeVue], stubs: { ConfirmDialog: true } }
        });
        await flushPromises();

        await wrapper.get('[aria-label="Backup authenticator 삭제"]').trigger('click');
        expect(confirmRequire).toHaveBeenCalledOnce();
        await confirmRequire.mock.calls[0][0].accept();
        expect(securityAuthStore.unenrollTotp).toHaveBeenCalledWith('factor-backup');
        wrapper.unmount();

        expect(securitySource).toContain('인증 앱 관리');
        expect(securitySource).toContain('beginTotpEnrollment');
        expect(securitySource).toContain('unenrollTotp');
        expect(securitySource).toContain('<ConfirmDialog />');
        expect(securitySource).not.toContain('localStorage');
        expect(securitySource).not.toContain('sessionStorage');
    });
});

describe('administrator menu-permission screen', () => {
    it('groups every stable menu leaf while marking fixed administrator routes', () => {
        const groups = buildPermissionGroups(erpMenu);
        const rows = groups.flatMap((group) => group.items);
        const menuLeaves = flattenMenuRoutes(erpMenu);

        expect(groups.map((group) => group.label)).toEqual(expect.arrayContaining(['개요', '업무', '분석 및 관리']));
        expect(rows.map((row) => row.menuKey)).toEqual(menuLeaves.map((row) => row.menuKey));
        expect(rows.find((row) => row.menuKey === 'settings.accounts')).toMatchObject({ fixed: true, label: '계정 관리' });
        expect(rows.find((row) => row.menuKey === 'settings.menu-permissions')).toMatchObject({ fixed: true, label: '메뉴 권한 관리' });
        expect(rows.find((row) => row.menuKey === 'settings.infrastructure-usage')).toMatchObject({ fixed: true, label: '인프라 사용량' });
        expect(rows.find((row) => row.menuKey === 'hr.core')).toBeTruthy();
        expect(permissionsSource).toContain("item.menuKey !== 'hr.core'");
    });

    it('compares permission keys independent of UI ordering', () => {
        expect(permissionKeysEqual(['sales.orders', 'dashboard'], ['dashboard', 'sales.orders'])).toBe(true);
        expect(permissionKeysEqual(['dashboard'], ['dashboard', 'sales.orders'])).toBe(false);
    });

    it('supports role selection, grouped toggles, reset, revision save, and admin locking', () => {
        expect(permissionsSource).toContain("{ label: '관리자', value: 'admin', locked: true }");
        expect(permissionsSource).toContain("{ label: '결재자', value: 'approver' }");
        expect(permissionsSource).toContain("{ label: '사용자', value: 'user' }");
        expect(permissionsSource).toContain('buildPermissionGroups(erpMenu)');
        expect(permissionsSource).toContain(':disabled="selectedRole === \'admin\' || item.fixed"');
        expect(permissionsSource).toContain('permissionKeysEqual(draftKeys.value, baselineKeys.value)');
        expect(permissionsSource).toContain('resetPermissions');
        expect(permissionsSource).toContain('await accessStore.save(selectedRole.value, draftKeys.value, selectedPermission.value.revision)');
        expect(permissionsSource).toContain('aria-label="관리할 계정 등급"');
        expect(permissionsSource).toContain(':aria-label="permissionToggleLabel(item)"');
    });

    it('reloads the latest revision after an optimistic-concurrency conflict', () => {
        expect(permissionsSource).toContain("error?.code === 'revision_conflict'");
        expect(permissionsSource).toContain('await loadPermissions();');
        expect(permissionsSource).toContain("summary: '권한 변경 충돌'");
        expect(permissionsSource).not.toContain('error.message');
    });

    it('has explicit loading, empty, retry, dirty, and responsive states', () => {
        expect(permissionsSource).toContain('메뉴 권한을 불러오는 중입니다.');
        expect(permissionsSource).toContain('표시할 메뉴 권한이 없습니다.');
        expect(permissionsSource).toContain('메뉴 권한 다시 불러오기');
        expect(permissionsSource).toContain('저장되지 않은 변경 사항이 있습니다.');
        expect(permissionsSource).toContain('overflow-x-auto');
        expect(permissionsSource).toContain('min-w-0');
    });
});

describe('administrator infrastructure usage screen', () => {
    it('loads both supported ranges and offers an icon refresh action', () => {
        expect(infrastructureSource).toContain("{ label: '24시간', value: '24h' }");
        expect(infrastructureSource).toContain("{ label: '7일', value: '7d' }");
        expect(infrastructureSource).toContain('await adminApi.getInfrastructureUsage(requestedRange)');
        expect(infrastructureSource).toContain('icon="pi pi-refresh"');
        expect(infrastructureSource).toContain('aria-label="인프라 사용량 새로고침"');
        expect(infrastructureSource).toContain(':disabled="refreshDisabled"');
        expect(infrastructureSource).toContain('requestSequence');
        expect(infrastructureSource).toContain('formatDurationUs');
        expect(infrastructureSource).toContain('value / 1000');
        expect(infrastructureSource).not.toContain('cpuTimeMs');
    });

    it('renders partial, unconfigured, unavailable, null metric, empty, and retry states without raw errors', () => {
        expect(infrastructureSource).toContain("partial: { label: '일부 확인', severity: 'warn' }");
        expect(infrastructureSource).toContain("unconfigured: { label: '설정 필요', severity: 'secondary' }");
        expect(infrastructureSource).toContain("unavailable: { label: '연결 실패', severity: 'danger' }");
        expect(infrastructureSource).toContain('const hasValue = (value) => value !== null && value !== undefined');
        expect(infrastructureSource).toContain('조회된 호출 내역이 없습니다.');
        expect(infrastructureSource).toContain('인프라 사용량 다시 불러오기');
        expect(infrastructureSource).toContain('generatedAt');
        expect(infrastructureSource).not.toContain('error.message');
        expect(infrastructureSource).not.toContain('SUPABASE_URL');
        expect(infrastructureSource).not.toContain('CLOUDFLARE_ACCOUNT_ID');
        expect(infrastructureSource).toContain('샘플링 기반 운영 지표');
        expect(infrastructureSource).toContain('시간별 운영 이력');
        expect(infrastructureSource).toContain('수집 한도에 도달해 상세 이력을 표시할 수 없습니다.');
        expect(infrastructureSource).toContain('연결 정보가 준비되면 사용량과 운영 상태가 여기에 표시됩니다.');
    });

    it('uses full-width provider cards and responsive metric grids without nested cards', () => {
        expect(infrastructureSource).toContain('class="min-w-0 card" aria-labelledby="supabase-heading"');
        expect(infrastructureSource).toContain('class="min-w-0 card" aria-labelledby="cloudflare-heading"');
        expect(infrastructureSource).toContain('[grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]');
        expect(infrastructureSource).toContain('min-w-0');
        expect(infrastructureSource).not.toContain('metric-tile card');
    });
});
