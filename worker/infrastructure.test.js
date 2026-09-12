import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';

const projectRef = 'abcdefghijklmnopqrst';
const baseEnv = Object.freeze({
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_sentinel',
    SUPABASE_MANAGEMENT_TOKEN: 'supabase-management-sentinel',
    CLOUDFLARE_API_TOKEN: 'cloudflare-token-sentinel',
    CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account-sentinel',
    CLOUDFLARE_WORKER_NAME: 'nexerp'
});

const json = (body, status = 200) => Response.json(body, { status });

function createUserClientFixture({ events = [], user = { id: 'admin-id' }, profile = { id: 'admin-id', role: 'admin', is_active: true }, authError = null } = {}) {
    const getUser = vi.fn(async () => {
        events.push('authenticate');
        return { data: { user }, error: authError };
    });
    const maybeSingle = vi.fn(async () => {
        events.push('authorize-profile');
        return { data: profile, error: null };
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { client: { auth: { getUser }, from }, getUser, from };
}

function managementResponses() {
    return {
        project: {
            id: 'must-not-leak-project-id',
            ref: projectRef,
            organization_id: 'must-not-leak-org-id',
            name: 'NEXERP',
            region: 'ap-northeast-2',
            status: 'ACTIVE_HEALTHY',
            database: { host: 'must-not-leak-database-host' }
        },
        health: [
            { name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY', info: { version: 'must-not-leak' } },
            { name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' },
            { name: 'pooler', healthy: true, status: 'ACTIVE_HEALTHY' },
            { name: 'realtime', healthy: true, status: 'ACTIVE_HEALTHY' },
            { name: 'rest', healthy: true, status: 'ACTIVE_HEALTHY' },
            { name: 'storage', healthy: false, status: 'COMING_UP', error: 'must-not-leak-health-error' }
        ],
        usage: {
            result: [
                { timestamp: '2026-09-11T02:00:00Z', total_auth_requests: 2, total_realtime_requests: 3, total_rest_requests: 5, total_storage_requests: 7 },
                { timestamp: '2026-09-11T03:00:00Z', total_auth_requests: 11, total_realtime_requests: 13, total_rest_requests: 17, total_storage_requests: 19 }
            ],
            error: null
        },
        diskUtil: { timestamp: '2026-09-12T02:00:00Z', metrics: { fs_size_bytes: 1000, fs_avail_bytes: 400, fs_used_bytes: 600 } },
        diskConfig: { attributes: { iops: 3000, size_gb: 8, throughput_mibps: 125, type: 'gp3' }, last_modified_at: 'must-not-leak' }
    };
}

function cloudflareResponse() {
    return {
        data: {
            viewer: {
                accounts: [
                    {
                        totals: [{ sum: { requests: 160, errors: 30, subrequests: 70 } }],
                        series: [
                            { dimensions: { datetime: '2026-09-12T01:00:00Z', status: 'success', scriptName: 'must-not-leak' }, sum: { requests: 10, errors: 1, subrequests: 4 } },
                            { dimensions: { datetime: '2026-09-12T02:00:00Z', status: 'scriptThrewException' }, sum: { requests: 6, errors: 2, subrequests: 3 } }
                        ]
                    }
                ]
            }
        },
        errors: null,
        extensions: { trace: 'must-not-leak' }
    };
}

function createProviderFetch({ events = [], overrides = {} } = {}) {
    const responses = managementResponses();
    return vi.fn(async (url, options = {}) => {
        events.push(`provider:${url}`);
        if (overrides[url]) return overrides[url](url, options);
        if (url === `https://api.supabase.com/v1/projects/${projectRef}`) return json(responses.project);
        if (url.startsWith(`https://api.supabase.com/v1/projects/${projectRef}/health?`)) return json(responses.health);
        if (url.startsWith(`https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/usage.api-counts?`)) return json(responses.usage);
        if (url === `https://api.supabase.com/v1/projects/${projectRef}/config/disk/util`) return json(responses.diskUtil);
        if (url === `https://api.supabase.com/v1/projects/${projectRef}/config/disk`) return json(responses.diskConfig);
        if (url === 'https://api.cloudflare.com/client/v4/graphql') return json(cloudflareResponse());
        if (url === `${baseEnv.SUPABASE_URL}/auth/v1/health`) return json({ version: 'must-not-leak-public-version' });
        throw new Error(`Unexpected provider URL: ${url}`);
    });
}

function createApp({ events = [], userFixture = createUserClientFixture({ events }), fetchImpl = createProviderFetch({ events }), timeoutMs = 50 } = {}) {
    const createSupabaseClient = vi.fn(() => userFixture.client);
    return {
        app: createWorkerApp({ createSupabaseClient, fetchImpl, now: () => new Date('2026-09-12T03:04:05.000Z'), providerTimeoutMs: timeoutMs }),
        createSupabaseClient,
        fetchImpl,
        userFixture
    };
}

const request = (query = 'range=24h', token = 'session-sentinel') =>
    new Request(`https://erp.test/api/admin/infrastructure/usage${query === null ? '' : `?${query}`}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

describe('administrator infrastructure usage API', () => {
    it('authenticates an active administrator before range validation or provider access', async () => {
        const events = [];
        const { app, fetchImpl } = createApp({ events });
        const guardedEnv = new Proxy(baseEnv, {
            get(target, property) {
                events.push(`read-config:${String(property)}`);
                return target[property];
            }
        });
        const missingAuth = await app.fetch(request('range=bad', null), guardedEnv);

        expect(missingAuth.status).toBe(401);
        expect(await missingAuth.json()).toEqual({ error: { code: 'missing_authorization', message: '인증 정보가 필요합니다.' } });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(events).toEqual([]);

        const nonAdminFixture = createUserClientFixture({ events, profile: { id: 'user-id', role: 'user', is_active: true } });
        const denied = createApp({ events, userFixture: nonAdminFixture, fetchImpl });
        const deniedResponse = await denied.app.fetch(request('range=bad'), baseEnv);

        expect(deniedResponse.status).toBe(403);
        expect(await deniedResponse.json()).toEqual({ error: { code: 'admin_required', message: '관리자 권한이 필요합니다.' } });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([null, '', 'range=', 'range=1h', 'range=24h&range=7d'])('rejects unsupported, empty, missing, or repeated range `%s` with a stable error', async (query) => {
        const { app, fetchImpl } = createApp();
        const response = await app.fetch(request(query), baseEnv);

        expect(response.status).toBe(400);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ error: { code: 'invalid_range', message: '조회 기간을 확인해 주세요.' } });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns normalized 24-hour Supabase and Cloudflare usage without sensitive provider fields', async () => {
        const { app, fetchImpl } = createApp();
        const response = await app.fetch(request(), baseEnv);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(body).toEqual({
            generatedAt: '2026-09-12T03:04:05.000Z',
            range: { key: '24h', start: '2026-09-11T03:04:05.000Z', end: '2026-09-12T03:04:05.000Z' },
            providers: {
                supabase: {
                    state: 'partial',
                    issues: [],
                    project: { name: 'NEXERP', region: 'ap-northeast-2', status: 'ACTIVE_HEALTHY' },
                    services: [
                        { name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY' },
                        { name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' },
                        { name: 'pooler', healthy: true, status: 'ACTIVE_HEALTHY' },
                        { name: 'realtime', healthy: true, status: 'ACTIVE_HEALTHY' },
                        { name: 'rest', healthy: true, status: 'ACTIVE_HEALTHY' },
                        { name: 'storage', healthy: false, status: 'COMING_UP' }
                    ],
                    usage: { totalRequests: 77, authRequests: 13, realtimeRequests: 16, restRequests: 22, storageRequests: 26 },
                    disk: { sizeBytes: 1000, availableBytes: 400, usedBytes: 600, provisionedSizeGb: 8, iops: 3000, throughputMibps: 125, type: 'gp3' }
                },
                cloudflare: {
                    state: 'ok',
                    issues: [],
                    requests: 160,
                    errors: 30,
                    subrequests: 70,
                    series: [
                        { datetime: '2026-09-12T01:00:00.000Z', status: 'success', requests: 10, errors: 1, subrequests: 4 },
                        { datetime: '2026-09-12T02:00:00.000Z', status: 'scriptThrewException', requests: 6, errors: 2, subrequests: 3 }
                    ]
                }
            }
        });

        const usageCall = fetchImpl.mock.calls.find(([url]) => url.includes('usage.api-counts'));
        expect(usageCall[0]).toContain('interval=1hr');
        expect(usageCall[1].headers).toEqual({ Authorization: 'Bearer supabase-management-sentinel', Accept: 'application/json' });
        const healthCall = fetchImpl.mock.calls.find(([url]) => url.includes('/health?'));
        expect(healthCall[0]).toContain('services=auth%2Cdb%2Cpooler%2Crealtime%2Crest%2Cstorage');
        expect(healthCall[0]).toContain('timeout_ms=2000');

        const graphqlCall = fetchImpl.mock.calls.find(([url]) => url === 'https://api.cloudflare.com/client/v4/graphql');
        const graphqlBody = JSON.parse(graphqlCall[1].body);
        expect(graphqlCall[1].headers).toEqual({ Authorization: 'Bearer cloudflare-token-sentinel', Accept: 'application/json', 'Content-Type': 'application/json' });
        expect(graphqlBody.variables).toEqual({
            accountTag: 'cloudflare-account-sentinel',
            datetimeStart: '2026-09-11T03:04:05.000Z',
            datetimeEnd: '2026-09-12T03:04:05.000Z',
            scriptName: 'nexerp'
        });
        expect(graphqlBody.query).toContain('workersInvocationsAdaptive');
        expect(graphqlBody.query).toContain('totals: workersInvocationsAdaptive');
        expect(graphqlBody.query).toContain('series: workersInvocationsAdaptive');
        expect(graphqlBody.query).toContain('requests');
        expect(graphqlBody.query).toContain('errors');
        expect(graphqlBody.query).toContain('subrequests');

        const serialized = JSON.stringify(body);
        for (const forbidden of ['abcdefghijklmnopqrst', 'must-not-leak', 'sentinel', 'organization_id', 'accountTag', 'scriptName', 'https://']) {
            expect(serialized).not.toContain(forbidden);
        }
    });

    it('uses daily Supabase buckets and a seven-day UTC window for range=7d', async () => {
        const { app, fetchImpl } = createApp();
        const response = await app.fetch(request('range=7d'), baseEnv);
        const body = await response.json();

        expect(body.range).toEqual({ key: '7d', start: '2026-09-05T03:04:05.000Z', end: '2026-09-12T03:04:05.000Z' });
        expect(fetchImpl.mock.calls.find(([url]) => url.includes('usage.api-counts'))[0]).toContain('interval=1day');
    });

    it('uses public Auth health only when the Supabase management token is absent', async () => {
        const env = { ...baseEnv, SUPABASE_MANAGEMENT_TOKEN: undefined };
        const { app, fetchImpl } = createApp();
        const response = await app.fetch(request(), env);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.providers.supabase).toEqual({
            state: 'partial',
            issues: ['missing_configuration', 'metric_unavailable'],
            project: null,
            services: [{ name: 'auth', healthy: true, status: 'reachable' }],
            usage: null,
            disk: null
        });
        expect(fetchImpl).toHaveBeenCalledWith(`${baseEnv.SUPABASE_URL}/auth/v1/health`, {
            method: 'GET',
            headers: { apikey: 'sb_publishable_sentinel', Accept: 'application/json' },
            signal: expect.any(AbortSignal)
        });
        expect(fetchImpl.mock.calls.some(([url]) => url.startsWith('https://api.supabase.com/'))).toBe(false);
    });

    it('keeps missing Supabase management configuration explicit when the public Auth probe fails', async () => {
        const env = { ...baseEnv, SUPABASE_MANAGEMENT_TOKEN: undefined };
        const healthUrl = `${baseEnv.SUPABASE_URL}/auth/v1/health`;
        const fetchImpl = createProviderFetch({ overrides: { [healthUrl]: () => json({ message: 'raw-public-health-sentinel' }, 503) } });
        const { app } = createApp({ fetchImpl });
        const response = await app.fetch(request(), env);
        const body = await response.json();

        expect(body.providers.supabase).toEqual({
            state: 'partial',
            issues: ['missing_configuration', 'provider_unavailable', 'metric_unavailable'],
            project: null,
            services: [{ name: 'auth', healthy: false, status: 'unreachable' }],
            usage: null,
            disk: null
        });
        expect(JSON.stringify(body)).not.toContain('raw-public-health-sentinel');
    });

    it('marks providers unconfigured without making provider calls when required configuration is missing', async () => {
        const { app, fetchImpl } = createApp();
        const response = await app.fetch(request(), {
            SUPABASE_URL: 'https://not-a-project.example.com',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-only'
        });
        const body = await response.json();

        expect(body.providers.supabase).toEqual({ state: 'unconfigured', issues: ['missing_configuration', 'metric_unavailable'], project: null, services: [], usage: null, disk: null });
        expect(body.providers.cloudflare).toEqual({ state: 'unconfigured', issues: ['missing_configuration', 'metric_unavailable'], requests: null, errors: null, subrequests: null, series: [] });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('keeps valid Supabase components while nulling malformed usage counts', async () => {
        const usageUrl = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/usage.api-counts?interval=1hr`;
        const fetchImpl = createProviderFetch({
            overrides: {
                [usageUrl]: () => json({ result: [{ timestamp: '2026-09-12T02:00:00Z', total_auth_requests: '4', total_realtime_requests: 1, total_rest_requests: 2, total_storage_requests: 3 }] })
            }
        });
        const { app } = createApp({ fetchImpl });
        const response = await app.fetch(request(), baseEnv);
        const body = await response.json();

        expect(body.providers.supabase.state).toBe('partial');
        expect(body.providers.supabase.issues).toEqual(['provider_invalid_response', 'metric_unavailable']);
        expect(body.providers.supabase.project).toEqual({ name: 'NEXERP', region: 'ap-northeast-2', status: 'ACTIVE_HEALTHY' });
        expect(body.providers.supabase.usage).toBeNull();
        expect(body.providers.supabase.disk.usedBytes).toBe(600);
    });

    it.each([
        [401, 'provider_auth_failed'],
        [403, 'provider_forbidden'],
        [429, 'provider_rate_limited'],
        [503, 'provider_unavailable']
    ])('keeps a 200 response and maps Cloudflare HTTP %s to %s', async (status, issue) => {
        const overrides = { 'https://api.cloudflare.com/client/v4/graphql': () => json({ errors: [{ message: 'raw-cloudflare-sentinel' }] }, status) };
        const fetchImpl = createProviderFetch({ overrides });
        const { app } = createApp({ fetchImpl });
        const response = await app.fetch(request(), baseEnv);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.providers.supabase.usage.totalRequests).toBe(77);
        expect(body.providers.cloudflare).toEqual({ state: 'unavailable', issues: [issue, 'metric_unavailable'], requests: null, errors: null, subrequests: null, series: [] });
        expect(JSON.stringify(body)).not.toContain('raw-cloudflare-sentinel');
    });

    it('treats HTTP-200 GraphQL errors and malformed numeric values as invalid provider responses', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const cases = [
            { errors: [{ message: 'raw-graphql-sentinel' }], data: cloudflareResponse().data },
            {
                errors: null,
                data: { viewer: { accounts: [{ totals: [{ sum: { requests: -1, errors: '2', subrequests: 3 } }], series: [] }] } }
            },
            {
                errors: null,
                data: {
                    viewer: {
                        accounts: [
                            {
                                totals: [{ sum: { requests: 1, errors: 0, subrequests: 0 } }],
                                series: [{ dimensions: { datetime: '2026-09-12T01:00:00Z', status: 'success' }, sum: { requests: 1.5, errors: 0, subrequests: 0 } }]
                            }
                        ]
                    }
                }
            }
        ];

        for (const providerBody of cases) {
            const fetchImpl = createProviderFetch({ overrides: { [graphqlUrl]: () => json(providerBody) } });
            const { app } = createApp({ fetchImpl });
            const response = await app.fetch(request(), baseEnv);
            const body = await response.json();

            expect(body.providers.cloudflare).toEqual({ state: 'unavailable', issues: ['provider_invalid_response', 'metric_unavailable'], requests: null, errors: null, subrequests: null, series: [] });
            expect(JSON.stringify(body)).not.toContain('raw-graphql-sentinel');
        }
    });

    it('maps an aborted provider request to provider_unavailable without failing the response', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const neverUntilAbort = (_url, options) =>
            new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new DOMException('raw-timeout-sentinel', 'AbortError')), { once: true });
            });
        const fetchImpl = createProviderFetch({ overrides: { [graphqlUrl]: neverUntilAbort } });
        const { app } = createApp({ fetchImpl, timeoutMs: 5 });
        const response = await app.fetch(request(), baseEnv);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.providers.cloudflare).toEqual({ state: 'unavailable', issues: ['provider_unavailable', 'metric_unavailable'], requests: null, errors: null, subrequests: null, series: [] });
        expect(JSON.stringify(body)).not.toContain('raw-timeout-sentinel');
    });
});
