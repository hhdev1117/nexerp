import { jsonResponse } from './http';
import { getBearerToken } from './auth';
import { handleAdminAccountRequest } from './admin';
import { createAdminSupabaseClient, createUserSupabaseClient } from './supabase';

const apiError = (status, code, message) => jsonResponse({ error: { code, message } }, { status });
const upstreamAuthErrorNames = new Set(['AuthRetryableFetchError', 'AuthUnknownError']);
const upstreamAuthErrorCodes = new Set(['unexpected_failure', 'request_timeout', 'hook_timeout', 'hook_timeout_after_retry', 'over_request_rate_limit']);

function isUpstreamAuthError(error) {
    const status = error?.status;
    return upstreamAuthErrorNames.has(error?.name) || upstreamAuthErrorCodes.has(error?.code) || status === 429 || (status >= 500 && status <= 599);
}

async function getCurrentUser(request, env, createSupabaseClient) {
    const token = getBearerToken(request);
    if (!token) return apiError(401, 'missing_authorization', '인증 정보가 필요합니다.');

    let supabase;
    try {
        supabase = createSupabaseClient(env, token);
    } catch (error) {
        if (error?.code === 'worker_configuration_error') {
            return apiError(503, 'service_unavailable', '서비스를 사용할 수 없습니다.');
        }
        return apiError(502, 'upstream_error', '인증 서비스를 사용할 수 없습니다.');
    }

    let authResult;
    try {
        authResult = await supabase.auth.getUser(token);
    } catch {
        return apiError(502, 'upstream_error', '인증 서비스를 사용할 수 없습니다.');
    }

    const user = authResult?.data?.user;
    if (authResult?.error) {
        if (isUpstreamAuthError(authResult.error)) {
            return apiError(502, 'upstream_error', '인증 서비스를 사용할 수 없습니다.');
        }
        return apiError(401, 'invalid_session', '유효하지 않은 로그인 세션입니다.');
    }
    if (!user) {
        return apiError(401, 'invalid_session', '유효하지 않은 로그인 세션입니다.');
    }

    let profileResult;
    try {
        profileResult = await supabase.from('profiles').select('id, email, display_name, department, role, is_active').eq('id', user.id).maybeSingle();
    } catch {
        return apiError(502, 'upstream_error', '인증 서비스를 사용할 수 없습니다.');
    }

    if (profileResult?.error) {
        return apiError(502, 'upstream_error', '인증 서비스를 사용할 수 없습니다.');
    }

    const profile = profileResult?.data;
    if (!profile || profile.is_active !== true) {
        return apiError(403, 'inactive_user', '비활성화된 사용자입니다.');
    }

    return jsonResponse({
        id: user.id,
        email: user.email,
        displayName: profile.display_name,
        department: profile.department,
        role: profile.role
    });
}

export function createWorkerApp({ createSupabaseClient = createUserSupabaseClient, createAdminClient = createAdminSupabaseClient } = {}) {
    return {
        async fetch(request, env) {
            const { pathname } = new URL(request.url);

            if (pathname === '/api/me' && request.method === 'GET') {
                return getCurrentUser(request, env, createSupabaseClient);
            }

            const accountMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
            const passwordMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/password$/);
            if ((pathname === '/api/admin/accounts' && (request.method === 'GET' || request.method === 'POST')) || (accountMatch && request.method === 'PATCH') || (passwordMatch && request.method === 'POST')) {
                return handleAdminAccountRequest(request, env, {
                    accountId: accountMatch?.[1] ?? passwordMatch?.[1] ?? null,
                    passwordReset: Boolean(passwordMatch),
                    createSupabaseClient,
                    createAdminClient
                });
            }

            if (pathname === '/api/health' && request.method === 'GET') {
                const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);

                return jsonResponse({ ok: configured, services: { supabase: configured ? 'configured' : 'missing_configuration' } }, { status: configured ? 200 : 503 });
            }

            if (pathname.startsWith('/api/')) {
                return jsonResponse({ error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' } }, { status: 404 });
            }

            return env.ASSETS.fetch(request);
        }
    };
}
