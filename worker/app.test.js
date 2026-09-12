import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';
import { jsonResponse } from './http';

const activeProfile = {
    id: 'user-1',
    email: 'profile@example.com',
    display_name: '김서준',
    department: '영업팀',
    role: 'approver',
    is_active: true
};

const createSupabaseFixture = ({ user = { id: 'user-1', email: 'login@example.com' }, authError = null, authThrows = null, profile = activeProfile, profileError = null, profileThrows = null } = {}) => {
    const maybeSingle = vi.fn(async () => {
        if (profileThrows) throw profileThrows;
        return { data: profile, error: profileError };
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const getUser = vi.fn(async () => {
        if (authThrows) throw authThrows;
        return { data: { user }, error: authError };
    });

    return { client: { auth: { getUser }, from }, getUser, from, select, eq };
};

describe('Cloudflare Worker app', () => {
    it.each([
        ['plain object', { 'cache-control': 'public, max-age=3600', 'x-request-id': 'object-header' }, 'object-header'],
        ['Headers instance', new Headers({ 'cache-control': 'public, max-age=3600', 'x-request-id': 'headers-instance' }), 'headers-instance'],
        [
            'iterable',
            [
                ['cache-control', 'public, max-age=3600'],
                ['x-request-id', 'iterable-header']
            ],
            'iterable-header'
        ]
    ])('normalizes %s response headers without dropping caller values', async (_label, headers, expectedRequestId) => {
        const response = jsonResponse(
            { ok: true },
            {
                status: 202,
                headers
            }
        );

        expect(response.status).toBe(202);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-request-id')).toBe(expectedRequestId);
        expect(await response.json()).toEqual({ ok: true });
    });

    it('requires authorization for the current-user endpoint', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/me'), {});

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
            error: { code: 'missing_authorization', message: '인증 정보가 필요합니다.' }
        });
    });

    it.each([
        ['GET', '/api/admin/accounts'],
        ['POST', '/api/admin/accounts'],
        ['PATCH', '/api/admin/accounts/11111111-1111-4111-8111-111111111111'],
        ['POST', '/api/admin/accounts/11111111-1111-4111-8111-111111111111/password']
    ])('routes %s %s through administrator authorization', async (method, path) => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request(`https://erp.test${path}`, { method }), {});

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
            error: { code: 'missing_authorization', message: '인증 정보가 필요합니다.' }
        });
    });

    it.each([
        ['GET', '/api/admin/accounts/11111111-1111-4111-8111-111111111111/password'],
        ['PATCH', '/api/admin/accounts/11111111-1111-4111-8111-111111111111/password'],
        ['PUT', '/api/admin/accounts/11111111-1111-4111-8111-111111111111/password'],
        ['POST', '/api/admin/accounts/11111111-1111-4111-8111-111111111111']
    ])('does not dispatch the wrong administrator account method: %s %s', async (method, path) => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request(`https://erp.test${path}`, { method }), {});

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' }
        });
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not dispatch the wrong infrastructure usage method: %s', async (method) => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/admin/infrastructure/usage?range=24h', { method }), {});

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' } });
    });

    it('reports missing Worker configuration without exposing configuration values', async () => {
        const request = new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } });
        const app = createWorkerApp();
        const response = await app.fetch(request, { SUPABASE_URL: 'https://sensitive-project.supabase.co' });
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body).toEqual({ error: { code: 'service_unavailable', message: '서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('sensitive-project');
        expect(JSON.stringify(body)).not.toContain('session-token');
    });

    it('rejects an invalid session with a stable error', async () => {
        const fixture = createSupabaseFixture({
            user: null,
            authError: { name: 'AuthApiError', status: 401, code: 'bad_jwt', message: 'raw rejected token detail' }
        });
        const app = createWorkerApp({ createSupabaseClient: () => fixture.client });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer rejected-token' } }), {});
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: { code: 'invalid_session', message: '유효하지 않은 로그인 세션입니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw rejected token detail');
        expect(JSON.stringify(body)).not.toContain('rejected-token');
    });

    it.each([
        ['retryable network error', { name: 'AuthRetryableFetchError', status: 0, code: undefined, message: 'raw retryable network detail' }, 'raw retryable network detail'],
        ['HTTP 503 error', { name: 'AuthApiError', status: 503, code: 'unexpected_failure', message: 'raw 503 detail' }, 'raw 503 detail'],
        ['rate limit error', { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'raw 429 detail' }, 'raw 429 detail']
    ])('returns a stable upstream error for a returned %s', async (_label, authError, rawDetail) => {
        const fixture = createSupabaseFixture({ user: null, authError });
        const app = createWorkerApp({ createSupabaseClient: () => fixture.client });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '인증 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain(rawDetail);
        expect(fixture.from).not.toHaveBeenCalled();
    });

    it('returns a stable upstream error when authentication throws', async () => {
        const fixture = createSupabaseFixture({ authThrows: new Error('raw auth outage') });
        const app = createWorkerApp({ createSupabaseClient: () => fixture.client });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '인증 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw auth outage');
    });

    it.each([[null], [{ ...activeProfile, is_active: false }]])('forbids an absent or inactive profile %#', async (profile) => {
        const fixture = createSupabaseFixture({ profile });
        const app = createWorkerApp({ createSupabaseClient: () => fixture.client });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } }), {});

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: { code: 'inactive_user', message: '비활성화된 사용자입니다.' }
        });
    });

    it.each([[{ profileError: new Error('raw profile query detail') }], [{ profileThrows: new Error('raw profile transport detail') }]])('returns a stable upstream error for profile failures %#', async (fixtureOptions) => {
        const fixture = createSupabaseFixture(fixtureOptions);
        const app = createWorkerApp({ createSupabaseClient: () => fixture.client });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '인증 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw profile');
    });

    it('returns only the permitted identity fields for an active profile', async () => {
        const fixture = createSupabaseFixture({ profile: { ...activeProfile, private_note: 'must-not-leak' } });
        const createSupabaseClient = vi.fn(() => fixture.client);
        const app = createWorkerApp({ createSupabaseClient });
        const response = await app.fetch(new Request('https://erp.test/api/me', { headers: { Authorization: 'Bearer session-token' } }), {});

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 'user-1',
            email: 'login@example.com',
            displayName: '김서준',
            department: '영업팀',
            role: 'approver'
        });
        expect(createSupabaseClient).toHaveBeenCalledWith({}, 'session-token');
        expect(fixture.getUser).toHaveBeenCalledWith('session-token');
        expect(fixture.from).toHaveBeenCalledWith('profiles');
        expect(fixture.select).toHaveBeenCalledWith('id, email, display_name, department, role, is_active');
        expect(fixture.eq).toHaveBeenCalledWith('id', 'user-1');
    });

    it('reports configured health without exposing values', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/health'), {
            SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example'
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({ ok: true, services: { supabase: 'configured' } });
    });

    it('reports missing Supabase configuration', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/health'), {
            SUPABASE_URL: 'https://project.supabase.co'
        });

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({ ok: false, services: { supabase: 'missing_configuration' } });
    });

    it('returns the API not-found response for unknown API paths', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/orders'), {});

        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({
            error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' }
        });
    });

    it('uses the assets binding outside the API namespace', async () => {
        const request = new Request('https://erp.test/sales/orders');
        const fetch = vi.fn().mockResolvedValue(new Response('app'));
        const app = createWorkerApp();
        const response = await app.fetch(request, { ASSETS: { fetch } });

        expect(await response.text()).toBe('app');
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(request);
    });
});
