import { getSupabaseClient } from '@/lib/supabase/client';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const moduleValid = (row) =>
    row &&
    text(row.key) &&
    text(row.label) &&
    typeof row.available === 'boolean' &&
    ['enabled', 'draining', 'read_only', 'disabled'].includes(row.state) &&
    typeof row.menuVisible === 'boolean' &&
    count(row.revision) &&
    count(row.pendingActions) &&
    Array.isArray(row.dependents) &&
    row.dependents.every(text) &&
    (row.available || (row.state === 'disabled' && !row.menuVisible && row.revision === 0 && row.pendingActions === 0));
const settingsValid = (data, company) => data && data.companyId === company && Array.isArray(data.modules) && data.modules.length > 0 && data.modules.every(moduleValid) && new Set(data.modules.map((row) => row.key)).size === data.modules.length;

export const hrModuleErrorMessage = (code) =>
    ({
        revision_conflict: '다른 작업에서 모듈 설정이 변경되었습니다. 최신 설정을 다시 불러와 주세요.',
        module_pending_actions: '예정된 발령이 남아 있습니다. 발령을 완료하거나 취소한 뒤 다시 시도해 주세요.',
        module_unavailable: '아직 사용할 수 없는 인사 모듈입니다.',
        access_denied: '모듈 설정을 관리할 권한과 2단계 인증을 확인해 주세요.'
    })[code] || '인사 모듈 설정을 처리하지 못했습니다. 다시 시도해 주세요.';

export function createHrModuleRepository(client = getSupabaseClient()) {
    const request = async (name, params) => {
        try {
            if (!uuid(params.target_company)) throw new Error();
            const response = await client.rpc(name, params);
            if (!response || response.error) throw response?.error;
            if (!settingsValid(response.data, params.target_company)) throw new Error();
            return response.data;
        } catch (cause) {
            const code =
                cause?.code === '40001'
                    ? 'revision_conflict'
                    : cause?.code === '42501'
                      ? 'access_denied'
                      : cause?.code === '22023' && ['module_pending_actions', 'module_unavailable'].includes(cause.message)
                        ? cause.message
                        : 'hr_module_request_failed';
            const error = new Error(hrModuleErrorMessage(code));
            error.code = code;
            throw error;
        }
    };
    return {
        loadSettings: (companyId) => request('hr_module_settings', { target_company: companyId }),
        saveSettings: (companyId, moduleKey, revision, state, menuVisible, reason) =>
            request('hr_save_module_settings', {
                target_company: companyId,
                module_key: moduleKey,
                expected_revision: revision,
                desired_state: state,
                menu_visible: menuVisible,
                change_reason: reason
            })
    };
}
