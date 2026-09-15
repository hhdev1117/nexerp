import { getBearerToken } from './auth';
import { jsonResponse } from './http';
import { loginIdToInternalEmail } from './loginIdentity';
import { createAdminSupabaseClient, createUserSupabaseClient } from './supabase';

const accountColumns = 'id, login_id, display_name, department, role, is_active, created_at, updated_at';
const allowedCreateRoles = new Set(['approver', 'user']);
const allowedUpdateRoles = new Set(['admin', 'approver', 'user']);
const duplicateLoginIdCodes = new Set(['email_exists', 'user_already_exists']);
const missingUserCodes = new Set(['user_not_found']);
const upstreamAuthErrorNames = new Set(['AuthRetryableFetchError', 'AuthUnknownError']);
const upstreamAuthErrorCodes = new Set(['unexpected_failure', 'request_timeout', 'hook_timeout', 'hook_timeout_after_retry', 'over_request_rate_limit']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const apiError = (status, code, message) => jsonResponse({ error: { code, message } }, { status });
const upstreamError = () => apiError(502, 'upstream_error', '계정 관리 서비스를 사용할 수 없습니다.');
const serviceUnavailable = () => apiError(503, 'service_unavailable', '계정 관리 서비스를 사용할 수 없습니다.');

function isUpstreamAuthError(error) {
    const status = error?.status;
    return upstreamAuthErrorNames.has(error?.name) || upstreamAuthErrorCodes.has(error?.code) || status === 429 || (status >= 500 && status <= 599);
}

function publicAccount(profile) {
    return {
        id: profile.id,
        loginId: profile.login_id,
        displayName: profile.display_name,
        department: profile.department,
        role: profile.role,
        isActive: profile.is_active,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
    };
}

function singleRow(data) {
    return Array.isArray(data) ? data[0] : data;
}

export async function authorizeAdministrator(request, env, createSupabaseClient) {
    const token = getBearerToken(request);
    if (!token) return { response: apiError(401, 'missing_authorization', '인증 정보가 필요합니다.') };

    let client;
    try {
        client = createSupabaseClient(env, token);
    } catch (error) {
        return { response: error?.code === 'worker_configuration_error' ? serviceUnavailable() : upstreamError() };
    }

    let authResult;
    try {
        authResult = await client.auth.getUser(token);
    } catch {
        return { response: upstreamError() };
    }

    if (authResult?.error) {
        return { response: isUpstreamAuthError(authResult.error) ? upstreamError() : apiError(401, 'invalid_session', '유효하지 않은 로그인 세션입니다.') };
    }

    const user = authResult?.data?.user;
    if (!user) return { response: apiError(401, 'invalid_session', '유효하지 않은 로그인 세션입니다.') };

    let assuranceResult;
    try {
        assuranceResult = await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
    } catch {
        return { response: upstreamError() };
    }
    if (assuranceResult?.error || !assuranceResult?.data) return { response: upstreamError() };
    if (assuranceResult.data.currentLevel !== 'aal2') {
        return { response: apiError(403, 'mfa_required', '다중 인증을 완료한 후 다시 시도해 주세요.') };
    }

    let profileResult;
    try {
        profileResult = await client.from('profiles').select('id, role, is_active').eq('id', user.id).maybeSingle();
    } catch {
        return { response: upstreamError() };
    }

    if (profileResult?.error) return { response: upstreamError() };

    const profile = profileResult?.data;
    if (!profile || profile.is_active !== true) {
        return { response: apiError(403, 'inactive_user', '비활성화된 사용자입니다.') };
    }
    if (profile.role !== 'admin') {
        return { response: apiError(403, 'admin_required', '관리자 권한이 필요합니다.') };
    }

    return { client, user };
}

async function parseBody(request) {
    try {
        const body = await request.json();
        return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { response: apiError(400, 'invalid_request', '요청 내용을 확인해 주세요.') };
    } catch {
        return { response: apiError(400, 'invalid_request', '요청 내용을 확인해 주세요.') };
    }
}

function requiredText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
}

function temporaryPassword(value) {
    if (typeof value !== 'string') return null;
    return value.length >= 8 && value.length <= 128 && /\S/.test(value) ? value : null;
}

function validateCreatePayload(body) {
    const loginId = body.loginId;
    const email = loginIdToInternalEmail(loginId);
    if (!email) return { response: apiError(400, 'invalid_login_id', '로그인 ID 형식을 확인해 주세요.') };

    const password = temporaryPassword(body.temporaryPassword);
    if (!password) {
        return { response: apiError(400, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.') };
    }

    const displayName = requiredText(body.displayName, 100);
    if (!displayName) return { response: apiError(400, 'invalid_display_name', '이름을 입력해 주세요.') };

    const department = requiredText(body.department, 100);
    if (!department) return { response: apiError(400, 'invalid_department', '부서를 입력해 주세요.') };

    if (!allowedCreateRoles.has(body.role)) {
        return { response: apiError(400, 'invalid_role', '생성할 계정의 권한을 확인해 주세요.') };
    }

    return { data: { loginId, email, temporaryPassword: password, displayName, department, role: body.role } };
}

function validateUpdatePayload(accountId, body) {
    if (!uuidPattern.test(accountId)) return { response: apiError(400, 'invalid_account_id', '올바른 계정 ID가 아닙니다.') };

    if (Object.keys(body).length === 1 && Object.hasOwn(body, 'isActive')) {
        if (typeof body.isActive !== 'boolean') return { response: apiError(400, 'invalid_activation', '계정 활성화 상태를 확인해 주세요.') };
        return { data: { isActive: body.isActive }, statusOnly: true };
    }

    const displayName = requiredText(body.displayName, 100);
    if (!displayName) return { response: apiError(400, 'invalid_display_name', '이름을 입력해 주세요.') };

    const department = requiredText(body.department, 100);
    if (!department) return { response: apiError(400, 'invalid_department', '부서를 입력해 주세요.') };

    if (!allowedUpdateRoles.has(body.role)) return { response: apiError(400, 'invalid_role', '계정 권한을 확인해 주세요.') };
    if (typeof body.isActive !== 'boolean') return { response: apiError(400, 'invalid_activation', '계정 활성화 상태를 확인해 주세요.') };

    return { data: { displayName, department, role: body.role, isActive: body.isActive } };
}

function validatePasswordResetPayload(accountId, body) {
    if (!uuidPattern.test(accountId)) return { response: apiError(400, 'invalid_account_id', '올바른 계정 ID가 아닙니다.') };

    const password = temporaryPassword(body.temporaryPassword);
    if (!password) return { response: apiError(400, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.') };

    return { temporaryPassword: password };
}

function mapProfileRpcError(error) {
    if (error?.message === 'self_demotion_forbidden') {
        return apiError(400, 'self_demotion_forbidden', '현재 관리자 계정의 권한은 변경할 수 없습니다.');
    }
    if (error?.message === 'self_deactivation_forbidden') {
        return apiError(400, 'self_deactivation_forbidden', '현재 관리자 계정은 비활성화할 수 없습니다.');
    }
    if (error?.message === 'profile_not_found') {
        return apiError(400, 'account_not_found', '계정을 찾을 수 없습니다.');
    }
    if (error?.message === 'admin_required' || error?.code === '42501') {
        return apiError(403, 'admin_required', '관리자 권한이 필요합니다.');
    }
    return upstreamError();
}

async function listAccounts(client) {
    let result;
    try {
        result = await client.from('profiles').select(accountColumns).order('created_at', { ascending: false });
    } catch {
        return upstreamError();
    }

    if (result?.error || !Array.isArray(result?.data)) return upstreamError();
    return jsonResponse({ accounts: result.data.map(publicAccount) });
}

async function compensateCreatedUser(adminClient, userId) {
    try {
        await adminClient.auth.admin.deleteUser(userId);
    } catch {
        // Compensation is best-effort; the response must not reveal provider details.
    }
}

async function createAccount(request, env, client, createAdminClient) {
    const parsed = await parseBody(request);
    if (parsed.response) return parsed.response;

    const validated = validateCreatePayload(parsed.body);
    if (validated.response) return validated.response;

    let adminClient;
    try {
        adminClient = createAdminClient(env);
    } catch (error) {
        return error?.code === 'worker_configuration_error' ? serviceUnavailable() : upstreamError();
    }

    const input = validated.data;
    const provisioningNonce = crypto.randomUUID();
    let prepared;
    try {
        prepared = await adminClient.rpc('prepare_user_provisioning', {
            target_login_id: input.loginId,
            provisioning_nonce: provisioningNonce
        });
    } catch {
        return upstreamError();
    }
    if (prepared?.error || prepared?.data !== true) return upstreamError();

    let createResult;
    try {
        createResult = await adminClient.auth.admin.createUser({
            email: input.email,
            password: input.temporaryPassword,
            email_confirm: true,
            app_metadata: { nexerp_provisioned: true, login_id: input.loginId },
            user_metadata: { provisioning_nonce: provisioningNonce }
        });
    } catch {
        return upstreamError();
    }

    if (createResult?.error) {
        return duplicateLoginIdCodes.has(createResult.error.code) ? apiError(409, 'login_id_exists', '이미 사용 중인 로그인 ID입니다.') : upstreamError();
    }

    const userId = createResult?.data?.user?.id;
    if (!userId) return upstreamError();

    let updateResult;
    try {
        updateResult = await client.rpc('admin_update_profile', {
            target_id: userId,
            new_display_name: input.displayName,
            new_department: input.department,
            new_role: input.role,
            new_is_active: true
        });
    } catch {
        await compensateCreatedUser(adminClient, userId);
        return upstreamError();
    }

    if (updateResult?.error || !singleRow(updateResult?.data)) {
        await compensateCreatedUser(adminClient, userId);
        return updateResult?.error ? mapProfileRpcError(updateResult.error) : upstreamError();
    }

    return jsonResponse({ account: publicAccount(singleRow(updateResult.data)) }, { status: 201 });
}

async function updateAccount(request, client, accountId) {
    const parsed = await parseBody(request);
    if (parsed.response) return parsed.response;

    const validated = validateUpdatePayload(accountId, parsed.body);
    if (validated.response) return validated.response;

    const input = validated.data;
    let result;
    try {
        result = validated.statusOnly
            ? await client.rpc('admin_update_profile_status', {
                  target_id: accountId,
                  new_is_active: input.isActive
              })
            : await client.rpc('admin_update_profile', {
                  target_id: accountId,
                  new_display_name: input.displayName,
                  new_department: input.department,
                  new_role: input.role,
                  new_is_active: input.isActive
              });
    } catch {
        return upstreamError();
    }

    if (result?.error) return mapProfileRpcError(result.error);
    const account = singleRow(result?.data);
    return account ? jsonResponse({ account: publicAccount(account) }) : upstreamError();
}

async function resetAccountPassword(request, env, accountId, createAdminClient) {
    const parsed = await parseBody(request);
    if (parsed.response) return parsed.response;

    const validated = validatePasswordResetPayload(accountId, parsed.body);
    if (validated.response) return validated.response;

    let adminClient;
    try {
        adminClient = createAdminClient(env);
    } catch (error) {
        return error?.code === 'worker_configuration_error' ? serviceUnavailable() : upstreamError();
    }

    let result;
    try {
        result = await adminClient.auth.admin.updateUserById(accountId, { password: validated.temporaryPassword });
    } catch {
        return upstreamError();
    }

    if (result?.error) {
        return missingUserCodes.has(result.error.code) || result.error.status === 404 ? apiError(404, 'account_not_found', '계정을 찾을 수 없습니다.') : upstreamError();
    }
    if (typeof result?.data?.user?.id !== 'string' || result.data.user.id.toLowerCase() !== accountId.toLowerCase()) return upstreamError();

    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

async function resetAccountMfa(env, accountId, createAdminClient) {
    if (!uuidPattern.test(accountId)) return apiError(400, 'invalid_account_id', '올바른 계정 ID가 아닙니다.');

    let adminClient;
    try {
        adminClient = createAdminClient(env);
    } catch (error) {
        return error?.code === 'worker_configuration_error' ? serviceUnavailable() : upstreamError();
    }

    let listed;
    try {
        listed = await adminClient.auth.admin.mfa.listFactors({ userId: accountId });
    } catch {
        return upstreamError();
    }
    const factors = listed?.data?.factors;
    if (listed?.error || !Array.isArray(factors) || factors.some((factor) => !factor || typeof factor.id !== 'string' || !factor.id.trim() || typeof factor.factor_type !== 'string')) return upstreamError();

    let failed = false;
    for (const factor of factors) {
        if (factor.factor_type !== 'totp') continue;
        let deleted;
        try {
            deleted = await adminClient.auth.admin.mfa.deleteFactor({ id: factor.id, userId: accountId });
        } catch {
            failed = true;
            continue;
        }
        if (deleted?.error || deleted?.data?.id !== factor.id) failed = true;
    }

    return failed ? upstreamError() : new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function handleAdminAccountRequest(request, env, { accountId = null, passwordReset = false, mfaReset = false, createSupabaseClient = createUserSupabaseClient, createAdminClient = createAdminSupabaseClient } = {}) {
    const authorization = await authorizeAdministrator(request, env, createSupabaseClient);
    if (authorization.response) return authorization.response;

    if (request.method === 'GET' && accountId === null) return listAccounts(authorization.client);
    if (request.method === 'POST' && accountId === null) return createAccount(request, env, authorization.client, createAdminClient);
    if (request.method === 'PATCH' && accountId !== null) return updateAccount(request, authorization.client, accountId);
    if (request.method === 'POST' && accountId !== null && passwordReset) {
        if (typeof authorization.user.id === 'string' && accountId.toLowerCase() === authorization.user.id.toLowerCase()) {
            return apiError(403, 'self_password_reset_forbidden', '현재 관리자 계정의 비밀번호는 이 방식으로 변경할 수 없습니다.');
        }
        return resetAccountPassword(request, env, accountId, createAdminClient);
    }
    if (request.method === 'POST' && accountId !== null && mfaReset) {
        if (typeof authorization.user.id === 'string' && accountId.toLowerCase() === authorization.user.id.toLowerCase()) {
            return apiError(403, 'self_mfa_reset_forbidden', '현재 관리자 계정의 인증 앱은 이 방식으로 초기화할 수 없습니다.');
        }
        return resetAccountMfa(env, accountId, createAdminClient);
    }

    return apiError(400, 'invalid_request', '요청 내용을 확인해 주세요.');
}
