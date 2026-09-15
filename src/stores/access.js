import { createSupabaseAccessRepository } from '@/repositories/access/supabaseAccessRepository';
import { ref } from 'vue';

const LOAD_FAILURE_MESSAGE = '메뉴 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const SAVE_FAILURE_MESSAGE = '메뉴 권한을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const FIXED_ADMIN_ACCESS = Object.freeze({
    role: 'admin',
    allowed_menu_keys: Object.freeze([]),
    revision: 0,
    updated_at: null,
    updated_by: null,
    fixed: true
});

const isPermissionRow = (row, role) => Boolean(row && row.role === role && Array.isArray(row.allowed_menu_keys));

const storeFailure = (source, fallback) => {
    const error = new Error(source?.code === 'revision_conflict' ? '메뉴 권한이 다른 작업에서 변경되었습니다. 최신 상태를 다시 불러와 주세요.' : fallback);
    error.name = 'AccessStoreError';
    error.code = source?.code === 'revision_conflict' ? 'revision_conflict' : 'access_request_failed';
    return error;
};

export function createAccessStore({ repository = createSupabaseAccessRepository() } = {}) {
    const permissionsByRole = ref({});
    const loading = ref(false);
    const error = ref(null);
    const inFlightLoads = new Map();
    let pendingOperations = 0;

    const beginOperation = () => {
        pendingOperations += 1;
        loading.value = true;
    };

    const endOperation = () => {
        pendingOperations = Math.max(0, pendingOperations - 1);
        loading.value = pendingOperations > 0;
    };

    const cache = (row) => {
        permissionsByRole.value = { ...permissionsByRole.value, [row.role]: row };
        return row;
    };

    const ensureLoaded = (role) => {
        if (role === 'admin') return Promise.resolve(permissionsByRole.value.admin || FIXED_ADMIN_ACCESS);
        if (!role) return Promise.resolve(null);
        if (permissionsByRole.value[role]) return Promise.resolve(permissionsByRole.value[role]);
        if (inFlightLoads.has(role)) return inFlightLoads.get(role);

        const request = (async () => {
            beginOperation();
            try {
                const row = await repository.loadForRole(role);
                if (!isPermissionRow(row, role)) {
                    error.value = LOAD_FAILURE_MESSAGE;
                    return null;
                }

                error.value = null;
                return cache(row);
            } catch {
                error.value = LOAD_FAILURE_MESSAGE;
                return null;
            } finally {
                endOperation();
                inFlightLoads.delete(role);
            }
        })();

        inFlightLoads.set(role, request);
        return request;
    };

    const canAccess = (menuKey, role) => {
        if (!menuKey || !role) return false;
        if (role === 'admin') return true;
        return Boolean(permissionsByRole.value[role]?.allowed_menu_keys.includes(menuKey));
    };

    const loadAll = async () => {
        beginOperation();
        try {
            const rows = await repository.loadAll();
            const validRows = rows.filter((row) => isPermissionRow(row, row?.role));
            permissionsByRole.value = Object.fromEntries(validRows.map((row) => [row.role, row]));
            error.value = null;
            return validRows;
        } catch (cause) {
            const normalized = storeFailure(cause, LOAD_FAILURE_MESSAGE);
            error.value = normalized.message;
            throw normalized;
        } finally {
            endOperation();
        }
    };

    const save = async (role, keys, revision) => {
        beginOperation();
        try {
            const row = await repository.save(role, keys, revision);
            if (!isPermissionRow(row, role)) throw storeFailure(null, SAVE_FAILURE_MESSAGE);
            error.value = null;
            return cache(row);
        } catch (cause) {
            const normalized = cause?.name === 'AccessStoreError' ? cause : storeFailure(cause, SAVE_FAILURE_MESSAGE);
            error.value = normalized.message;
            throw normalized;
        } finally {
            endOperation();
        }
    };

    return { permissionsByRole, loading, error, ensureLoaded, canAccess, loadAll, save };
}

let browserStore;

export function useAccessStore() {
    if (!browserStore) browserStore = createAccessStore();
    return browserStore;
}
