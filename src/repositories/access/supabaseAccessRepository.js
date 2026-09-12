import { getSupabaseClient } from '@/lib/supabase/client';

const PERMISSION_FIELDS = 'role, allowed_menu_keys, revision, updated_at, updated_by';

export class AccessRepositoryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AccessRepositoryError';
        this.code = code;
    }
}

const failure = (operation, source) => {
    if (operation === 'save' && (source?.code === '40001' || source?.message === 'revision_conflict')) {
        return new AccessRepositoryError('revision_conflict', '메뉴 권한이 다른 작업에서 변경되었습니다. 최신 상태를 다시 불러와 주세요.');
    }

    const code = operation === 'save' ? 'access_save_failed' : 'access_load_failed';
    const message = operation === 'save' ? '메뉴 권한을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '메뉴 권한을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return new AccessRepositoryError(code, message);
};

const ensureClient = (client) => {
    if (!client) throw new AccessRepositoryError('access_not_configured', 'Supabase 연결 정보가 설정되지 않았습니다.');
};

const normalizeRow = (data) => (Array.isArray(data) ? data[0] || null : data || null);

export function createSupabaseAccessRepository(client = getSupabaseClient()) {
    const loadForRole = async (role) => {
        ensureClient(client);
        try {
            const { data, error } = await client.from('role_menu_permissions').select(PERMISSION_FIELDS).eq('role', role).maybeSingle();
            if (error) throw failure('load', error);
            return data || null;
        } catch (error) {
            if (error instanceof AccessRepositoryError) throw error;
            throw failure('load', error);
        }
    };

    const loadAll = async () => {
        ensureClient(client);
        try {
            const { data, error } = await client.from('role_menu_permissions').select(PERMISSION_FIELDS).order('role');
            if (error) throw failure('load', error);
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (error instanceof AccessRepositoryError) throw error;
            throw failure('load', error);
        }
    };

    const save = async (role, keys, revision) => {
        ensureClient(client);
        try {
            const { data, error } = await client.rpc('admin_replace_role_menu_permissions', {
                target_role: role,
                allowed_keys: keys,
                expected_revision: revision
            });
            if (error) throw failure('save', error);
            return normalizeRow(data);
        } catch (error) {
            if (error instanceof AccessRepositoryError) throw error;
            throw failure('save', error);
        }
    };

    return { loadForRole, loadAll, save };
}
