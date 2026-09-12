import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { erpMenu, flattenMenuRoutes } from '@/data/erp';
import { accountCreatePayload, accountUpdatePayload, buildPermissionGroups, createAccountDraft, createEditAccountDraft, permissionKeysEqual, validateAccountDraft, validatePasswordResetDraft } from './adminModels';

const source = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
const accountsSource = source('./AccountManagement.vue');
const permissionsSource = source('./MenuPermissionManagement.vue');

const existingAccount = {
    id: 'admin-1',
    email: 'admin@nexerp.test',
    displayName: '시스템 관리자',
    department: '시스템 관리',
    role: 'admin',
    isActive: true
};

describe('administrator account screen', () => {
    it('validates every required create field before submitting', () => {
        expect(validateAccountDraft(createAccountDraft(), 'create')).toEqual({
            email: '올바른 이메일 주소를 입력해 주세요.',
            temporaryPassword: '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.',
            displayName: '이름을 입력해 주세요.',
            department: '부서를 입력해 주세요.'
        });

        expect(
            validateAccountDraft(
                {
                    email: ' employee@nexerp.test ',
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
                email: ' Employee@NEXERP.test ',
                temporaryPassword: 'Temporary-9!',
                displayName: ' 김서준 ',
                department: ' 영업팀 ',
                role: 'user',
                isActive: false,
                submitted: true
            })
        ).toEqual({
            email: 'employee@nexerp.test',
            temporaryPassword: 'Temporary-9!',
            displayName: '김서준',
            department: '영업팀',
            role: 'user'
        });
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
        expect(accountsSource).toContain('const isCurrentAccount = (account) => account.id === authStore.user.value?.id');
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
        expect(accountsSource).toContain('min-width: 0');
    });

    it('provides explicit password-reset and ERP lock actions without allowing self-service', () => {
        expect(accountsSource).toContain('icon="pi pi-key"');
        expect(accountsSource).toContain("slotProps.data.isActive ? 'pi pi-lock' : 'pi pi-lock-open'");
        expect(accountsSource).toContain(':disabled="isCurrentAccount(slotProps.data)');
        expect(accountsSource).toContain('await adminApi.resetAccountPassword(passwordResetAccount.value.id, passwordResetDraft.value.temporaryPassword)');
        expect(accountsSource).toContain("header: locking ? 'ERP 계정 잠금' : '계정 활성화'");
        expect(accountsSource).toContain('adminApi.updateAccount(account.id, accountUpdatePayload({ ...account, isActive: !account.isActive }))');
        expect(accountsSource).toContain('account.id === updated.id ? updated : account');
        expect(accountsSource).toContain("passwordResetDraft.value = { temporaryPassword: '', confirmation: '' }");
        expect(accountsSource).toContain(':title="passwordResetActionLabel(slotProps.data)"');
        expect(accountsSource).toContain(':title="statusActionLabel(slotProps.data)"');
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
        expect(rows.some((row) => /인사|급여/.test(row.label))).toBe(false);
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
        expect(permissionsSource).toContain('overflow-x: auto');
        expect(permissionsSource).toContain('min-width: 0');
    });
});
