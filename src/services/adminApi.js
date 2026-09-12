import { useAuthStore } from '@/stores/auth';

const ERROR_MESSAGES = Object.freeze({
    authentication_required: '로그인이 필요합니다. 다시 로그인해 주세요.',
    missing_authorization: '로그인이 필요합니다. 다시 로그인해 주세요.',
    invalid_session: '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.',
    inactive_user: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
    admin_required: '관리자 권한이 필요합니다.',
    invalid_request: '요청 내용을 확인해 주세요.',
    invalid_email: '올바른 이메일 주소를 입력해 주세요.',
    invalid_temporary_password: '임시 비밀번호는 8자 이상이어야 합니다.',
    invalid_display_name: '이름을 입력해 주세요.',
    invalid_department: '부서를 입력해 주세요.',
    invalid_role: '계정 권한을 확인해 주세요.',
    invalid_activation: '계정 활성화 상태를 확인해 주세요.',
    invalid_account_id: '올바른 계정 ID가 아닙니다.',
    email_exists: '이미 사용 중인 이메일입니다.',
    self_demotion_forbidden: '현재 관리자 계정의 권한은 변경할 수 없습니다.',
    self_deactivation_forbidden: '현재 관리자 계정은 비활성화할 수 없습니다.',
    account_not_found: '계정을 찾을 수 없습니다.',
    service_unavailable: '계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    upstream_error: '계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'
});

const DEFAULT_FAILURE_MESSAGE = '계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_FAILURE_MESSAGE = '계정 관리 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export class AdminApiError extends Error {
    constructor(code, message, status = 0) {
        super(message);
        this.name = 'AdminApiError';
        this.code = code;
        this.status = status;
    }
}

const defaultAccessToken = () => useAuthStore().session.value?.access_token || null;

const parseJson = async (response) => {
    try {
        return await response.json();
    } catch {
        return null;
    }
};

export function createAdminApi({ fetchImpl = fetch, getAccessToken = defaultAccessToken } = {}) {
    const request = async (path, { method = 'GET', body } = {}) => {
        const token = await getAccessToken();
        if (!token) throw new AdminApiError('authentication_required', ERROR_MESSAGES.authentication_required, 401);

        const headers = { Authorization: `Bearer ${token}` };
        const options = { method, headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetchImpl(path, options);
        } catch {
            throw new AdminApiError('network_error', NETWORK_FAILURE_MESSAGE);
        }

        const payload = await parseJson(response);
        if (!response.ok) {
            const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'request_failed';
            throw new AdminApiError(code, ERROR_MESSAGES[code] || DEFAULT_FAILURE_MESSAGE, response.status);
        }

        return payload;
    };

    return {
        async listAccounts() {
            const payload = await request('/api/admin/accounts');
            if (!Array.isArray(payload?.accounts)) throw new AdminApiError('invalid_response', DEFAULT_FAILURE_MESSAGE);
            return payload.accounts;
        },
        async createAccount(input) {
            const payload = await request('/api/admin/accounts', { method: 'POST', body: input });
            if (!payload?.account) throw new AdminApiError('invalid_response', DEFAULT_FAILURE_MESSAGE);
            return payload.account;
        },
        async updateAccount(accountId, input) {
            const payload = await request(`/api/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body: input });
            if (!payload?.account) throw new AdminApiError('invalid_response', DEFAULT_FAILURE_MESSAGE);
            return payload.account;
        },
        async resetAccountPassword(accountId, temporaryPassword) {
            await request(`/api/admin/accounts/${encodeURIComponent(accountId)}/password`, {
                method: 'POST',
                body: { temporaryPassword }
            });
        }
    };
}

let browserApi;

export function useAdminApi() {
    if (!browserApi) browserApi = createAdminApi();
    return browserApi;
}
