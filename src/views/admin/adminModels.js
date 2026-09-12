const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIXED_ADMIN_KEYS = new Set(['settings.accounts', 'settings.menu-permissions']);

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
        if (typeof draft?.temporaryPassword !== 'string' || draft.temporaryPassword.trim().length < 8) {
            errors.temporaryPassword = '임시 비밀번호는 8자 이상이어야 합니다.';
        }
    }
    if (!draft?.displayName?.trim()) errors.displayName = '이름을 입력해 주세요.';
    if (!draft?.department?.trim()) errors.department = '부서를 입력해 주세요.';
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
