const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIXED_ADMIN_KEYS = new Set(['settings.accounts', 'settings.menu-permissions', 'settings.infrastructure-usage']);
const TEMPORARY_PASSWORD_ERROR = '임시 비밀번호는 8자 이상 128자 이하로 입력해 주세요.';

const isValidTemporaryPassword = (password) => typeof password === 'string' && password.length >= 8 && password.length <= 128 && Boolean(password.trim());

export const accountRoleOptions = Object.freeze([Object.freeze({ label: '관리자', value: 'admin' }), Object.freeze({ label: '결재자', value: 'approver' }), Object.freeze({ label: '사용자', value: 'user' })]);

export function createAccountDraft() {
    return {
        email: '',
        temporaryPassword: '',
        displayName: '',
        department: '',
        role: 'user',
        isActive: true
    };
}

export function createEditAccountDraft(account) {
    return {
        displayName: account?.displayName || '',
        department: account?.department || '',
        role: account?.role || 'user',
        isActive: account?.isActive === true
    };
}

export function validateAccountDraft(draft, mode) {
    const errors = {};
    if (mode === 'create') {
        const email = typeof draft?.email === 'string' ? draft.email.trim() : '';
        if (!EMAIL_PATTERN.test(email)) errors.email = '올바른 이메일 주소를 입력해 주세요.';
        if (!isValidTemporaryPassword(draft?.temporaryPassword)) errors.temporaryPassword = TEMPORARY_PASSWORD_ERROR;
    }
    if (!draft?.displayName?.trim()) errors.displayName = '이름을 입력해 주세요.';
    if (!draft?.department?.trim()) errors.department = '부서를 입력해 주세요.';
    return errors;
}

export function validatePasswordResetDraft(draft) {
    const errors = {};
    if (!isValidTemporaryPassword(draft?.temporaryPassword)) errors.temporaryPassword = TEMPORARY_PASSWORD_ERROR;
    if (typeof draft?.confirmation !== 'string' || !draft.confirmation.trim()) errors.confirmation = '임시 비밀번호 확인을 입력해 주세요.';
    else if (draft.confirmation !== draft?.temporaryPassword) errors.confirmation = '임시 비밀번호가 일치하지 않습니다.';
    return errors;
}

export function accountCreatePayload(draft) {
    return {
        email: draft.email.trim().toLowerCase(),
        temporaryPassword: draft.temporaryPassword,
        displayName: draft.displayName.trim(),
        department: draft.department.trim(),
        role: draft.role
    };
}

export function accountUpdatePayload(draft) {
    return {
        displayName: draft.displayName.trim(),
        department: draft.department.trim(),
        role: draft.role,
        isActive: draft.isActive === true
    };
}

export function buildPermissionGroups(menu) {
    return menu.map((section) => {
        const rows = [];

        const visit = (items, parents = []) => {
            for (const item of items || []) {
                if (item.to && item.menuKey) {
                    rows.push({
                        menuKey: item.menuKey,
                        label: item.label,
                        description: item.description,
                        category: parents.join(' / ') || section.label,
                        fixed: FIXED_ADMIN_KEYS.has(item.menuKey)
                    });
                }
                if (item.items) visit(item.items, item.to ? parents : parents.concat(item.label));
            }
        };

        visit(section.items);
        return { label: section.label, items: rows };
    });
}

export function permissionKeysEqual(left, right) {
    const normalize = (keys) => [...new Set(Array.isArray(keys) ? keys : [])].sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((key, index) => key === normalizedRight[index]);
}
