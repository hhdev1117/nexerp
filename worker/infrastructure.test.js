import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';

const projectRef = 'abcdefghijklmnopqrst';
const baseEnv = Object.freeze({
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_sentinel',
    SUPABASE_MANAGEMENT_TOKEN: 'supabase-management-sentinel',
    CLOUDFLARE_API_TOKEN: 'cloudflare-token-sentinel',
    CLOUDFLARE_ACCOUNT_ID: 'fb3e0684f8d1a9ced906edc27c0f3c8b',
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

function cloudflareResponse(overrides = {}) {
    return {
        data: {
            viewer: {
                accounts: [
                    {
                        totals: [{ sum: { requests: 160, errors: 30, subrequests: 70 }, quantiles: { cpuTimeP50: 2.5, cpuTimeP99: 12.75 } }],
                        series: [
                            { dimensions: { datetime: '2026-09-12T01:12:30Z', status: 'success', scriptName: 'must-not-leak' }, sum: { requests: 10, errors: 1, subrequests: 4 } },
                            { dimensions: { datetime: '2026-09-12T01:48:00Z', status: 'success' }, sum: { requests: 4, errors: 0, subrequests: 2 } },
                            { dimensions: { datetime: '2026-09-12T02:00:00Z', status: 'exceededResources' }, sum: { requests: 6, errors: 2, subrequests: 3 } }
                        ],
                        ...overrides
                    }
                ]
            }
        },
        errors: null,
        extensions: { trace: 'must-not-leak' }
    };
}

function cloudflareSettingsResponse(overrides = {}) {
    return {
        success: true,
        result: {
            usage_model: 'standard',
            limits: { cpu_ms: 50, subrequests: 1000 },
            bindings: [{ name: 'must-not-leak-binding', type: 'secret_text' }],
            annotations: { 'workers/message': 'must-not-leak-annotation' },
            ...overrides
        },
        errors: []
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
        if (url === `https://api.cloudflare.com/client/v4/accounts/${baseEnv.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${baseEnv.CLOUDFLARE_WORKER_NAME}/settings`) return json(cloudflareSettingsResponse());
        if (url === `${baseEnv.SUPABASE_URL}/auth/v1/health`) return json({ version: 'must-not-leak-public-version' });
        throw new Error(`Unexpected provider URL: ${url}`);
    });
}

function createApp({
    events = [],
    userFixture = createUserClientFixture({ events }),
    fetchImpl = createProviderFetch({ events }),
    timeoutMs = 50,
    now = () => new Date('2026-09-12T03:04:05.000Z'),
    infrastructureCache = { values: new Map(), inFlight: new Map() }
} = {}) {
    const createSupabaseClient = vi.fn(() => userFixture.client);
    return {
        app: createWorkerApp({ createSupabaseClient, fetchImpl, now, providerTimeoutMs: timeoutMs, infrastructureCache }),
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
                    errorRate: 18.75,
                    subrequests: 70,
                    cpuTimeMs: { p50: 2.5, p99: 12.75 },
                    byStatus: [
                        { status: 'success', requests: 14, errors: 1, subrequests: 6 },
                        { status: 'exceededResources', requests: 6, errors: 2, subrequests: 3 }
                    ],
                    settings: { usageModel: 'standard', cpuMs: 50, subrequests: 1000 },
                    series: [
                        { datetime: '2026-09-12T01:00:00.000Z', status: 'success', requests: 14, errors: 1, subrequests: 6 },
                        { datetime: '2026-09-12T02:00:00.000Z', status: 'exceededResources', requests: 6, errors: 2, subrequests: 3 }
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
            accountTag: 'fb3e0684f8d1a9ced906edc27c0f3c8b',
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
        expect(graphqlBody.query).toContain('quantiles { cpuTimeP50 cpuTimeP99 }');
        expect(graphqlBody.query).toContain('limit: 1000');
        expect(graphqlBody.query).toContain('orderBy: [datetime_ASC]');
        expect(graphqlBody.query).not.toContain('datetimeHour');

        const settingsCall = fetchImpl.mock.calls.find(([url]) => url.endsWith('/workers/scripts/nexerp/settings'));
        expect(settingsCall[1].headers).toEqual({ Authorization: 'Bearer cloudflare-token-sentinel', Accept: 'application/json' });

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
        expect(body.providers.cloudflare).toEqual({
            state: 'unconfigured',
            issues: ['missing_configuration', 'metric_unavailable'],
            requests: null,
            errors: null,
            errorRate: null,
            subrequests: null,
            cpuTimeMs: { p50: null, p99: null },
            byStatus: null,
            settings: null,
            series: []
        });
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

    it.each(['UNKNOWN', 'INIT_FAILED', 'REMOVED', 'RESTORING', 'UPGRADING', 'PAUSING', 'RESTORE_FAILED', 'RESTARTING', 'PAUSE_FAILED', 'RESIZING'])('accepts the official Supabase project state %s', async (status) => {
        const projectUrl = `https://api.supabase.com/v1/projects/${projectRef}`;
        const fetchImpl = createProviderFetch({
            overrides: { [projectUrl]: () => json({ ...managementResponses().project, status }) }
        });
        const { app } = createApp({ fetchImpl });
        const body = await (await app.fetch(request(), baseEnv)).json();

        expect(body.providers.supabase.project.status).toBe(status);
    });

    it('sanitizes a future Supabase project state and accepts disks without optional throughput', async () => {
        const projectUrl = `https://api.supabase.com/v1/projects/${projectRef}`;
        const diskUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/disk`;
        const disk = managementResponses().diskConfig;
        delete disk.attributes.throughput_mibps;
        const fetchImpl = createProviderFetch({
            overrides: {
                [projectUrl]: () => json({ ...managementResponses().project, status: 'FUTURE_PLATFORM_STATE' }),
                [diskUrl]: () => json(disk)
            }
        });
        const { app } = createApp({ fetchImpl });
        const body = await (await app.fetch(request(), baseEnv)).json();

        expect(body.providers.supabase.project.status).toBe('UNKNOWN');
        expect(body.providers.supabase.disk.throughputMibps).toBeNull();
        expect(body.providers.supabase.issues).not.toContain('provider_invalid_response');
        expect(JSON.stringify(body)).not.toContain('FUTURE_PLATFORM_STATE');
    });

    it('normalizes every documented Cloudflare invocation status and rejects invented values', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const statuses = ['success', 'clientDisconnected', 'scriptThrewException', 'exceededResources', 'internalError'];
        const series = statuses.map((status, index) => ({
            dimensions: { datetime: `2026-09-12T0${index}:15:00Z`, status },
            sum: { requests: index + 1, errors: index === 0 ? 0 : 1, subrequests: index }
        }));
        const fetchImpl = createProviderFetch({ overrides: { [graphqlUrl]: () => json(cloudflareResponse({ series })) } });
        const { app } = createApp({ fetchImpl });
        const valid = await (await app.fetch(request(), baseEnv)).json();

        expect(valid.providers.cloudflare.state).toBe('ok');
        expect(valid.providers.cloudflare.byStatus.map(({ status }) => status)).toEqual(statuses);
        expect(valid.providers.cloudflare.series.map(({ status }) => status)).toEqual(statuses);

        const invalidFetch = createProviderFetch({
            overrides: {
                [graphqlUrl]: () =>
                    json(
                        cloudflareResponse({
                            series: [{ dimensions: { datetime: '2026-09-12T01:00:00Z', status: 'exceededCpu' }, sum: { requests: 1, errors: 1, subrequests: 0 } }]
                        })
                    )
            }
        });
        const invalid = await (await createApp({ fetchImpl: invalidFetch }).app.fetch(request(), baseEnv)).json();
        expect(invalid.providers.cloudflare.state).toBe('partial');
        expect(invalid.providers.cloudflare.issues).toEqual(['provider_invalid_response', 'metric_unavailable']);
    });

    it('coalesces more than 100 sorted analytics rows into deterministic hourly operational buckets', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const start = Date.parse('2026-09-05T04:00:00.000Z');
        const series = Array.from({ length: 168 }, (_, index) => ({
            dimensions: { datetime: new Date(start + index * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(), status: 'success' },
            sum: { requests: 1, errors: 0, subrequests: 2 }
        }));
        const fetchImpl = createProviderFetch({ overrides: { [graphqlUrl]: () => json(cloudflareResponse({ series })) } });
        const { app } = createApp({ fetchImpl });
        const body = await (await app.fetch(request('range=7d'), baseEnv)).json();
        const graphqlBody = JSON.parse(fetchImpl.mock.calls.find(([url]) => url === graphqlUrl)[1].body);

        expect(body.providers.cloudflare.series).toHaveLength(168);
        expect(body.providers.cloudflare.series[0].datetime).toBe('2026-09-05T04:00:00.000Z');
        expect(body.providers.cloudflare.series.at(-1).datetime).toBe('2026-09-12T03:00:00.000Z');
        expect(graphqlBody.query).toContain('limit: 1000');
        expect(graphqlBody.query).toContain('orderBy: [datetime_ASC]');
    });

    it('marks analytics partial when the bounded series may be truncated', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const series = Array.from({ length: 1000 }, (_, index) => ({
            dimensions: { datetime: new Date(Date.parse('2026-09-12T01:00:00.000Z') + index * 1000).toISOString(), status: 'success' },
            sum: { requests: 1, errors: 0, subrequests: 0 }
        }));
        const fetchImpl = createProviderFetch({ overrides: { [graphqlUrl]: () => json(cloudflareResponse({ series })) } });
        const { app } = createApp({ fetchImpl });
        const body = await (await app.fetch(request(), baseEnv)).json();

        expect(body.providers.cloudflare.state).toBe('partial');
        expect(body.providers.cloudflare.issues).toEqual(['metric_unavailable']);
        expect(body.providers.cloudflare.requests).toBe(160);
        expect(body.providers.cloudflare.series).toHaveLength(1);
    });

    it('keeps analytics available when allowlisted script settings are malformed', async () => {
        const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${baseEnv.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${baseEnv.CLOUDFLARE_WORKER_NAME}/settings`;
        const fetchImpl = createProviderFetch({
            overrides: { [settingsUrl]: () => json(cloudflareSettingsResponse({ usage_model: 'raw-settings-sentinel' })) }
        });
        const { app } = createApp({ fetchImpl });
        const body = await (await app.fetch(request(), baseEnv)).json();

        expect(body.providers.cloudflare.state).toBe('partial');
        expect(body.providers.cloudflare.issues).toEqual(['provider_invalid_response', 'metric_unavailable']);
        expect(body.providers.cloudflare.requests).toBe(160);
        expect(body.providers.cloudflare.settings).toBeNull();
        expect(JSON.stringify(body)).not.toContain('raw-settings-sentinel');
    });

    it('authorizes every request before returning a cached normalized response', async () => {
        const infrastructureCache = { values: new Map(), inFlight: new Map() };
        const fetchImpl = createProviderFetch();
        const { app } = createApp({ fetchImpl, infrastructureCache });
        expect((await app.fetch(request(), baseEnv)).status).toBe(200);
        const providerCalls = fetchImpl.mock.calls.length;

        const guardedEnv = new Proxy(baseEnv, {
            get() {
                throw new Error('configuration must not be read');
            }
        });
        const denied = await app.fetch(request('range=24h', null), guardedEnv);

        expect(denied.status).toBe(401);
        expect(fetchImpl).toHaveBeenCalledTimes(providerCalls);
    });

    it('caches normalized results for 60 seconds with range-separated keys and expiry', async () => {
        let currentTime = Date.parse('2026-09-12T03:04:05.000Z');
        const fetchImpl = createProviderFetch();
        const infrastructureCache = { values: new Map(), inFlight: new Map() };
        const { app } = createApp({ fetchImpl, now: () => new Date(currentTime), infrastructureCache });

        const first = await (await app.fetch(request(), baseEnv)).json();
        currentTime += 59_999;
        const cached = await (await app.fetch(request(), baseEnv)).json();
        expect(cached).toEqual(first);
        expect(fetchImpl.mock.calls.filter(([url]) => url === 'https://api.cloudflare.com/client/v4/graphql')).toHaveLength(1);
        expect(JSON.stringify([...infrastructureCache.values.entries()])).not.toMatch(/sentinel|must-not-leak|bindings|annotations/);

        await app.fetch(request('range=7d'), baseEnv);
        expect(fetchImpl.mock.calls.filter(([url]) => url === 'https://api.cloudflare.com/client/v4/graphql')).toHaveLength(2);

        currentTime += 2;
        const refreshed = await (await app.fetch(request(), baseEnv)).json();
        expect(refreshed.generatedAt).not.toBe(first.generatedAt);
        expect(fetchImpl.mock.calls.filter(([url]) => url === 'https://api.cloudflare.com/client/v4/graphql')).toHaveLength(3);
    });

    it('deduplicates concurrent provider collection for the same authorized range', async () => {
        const graphqlUrl = 'https://api.cloudflare.com/client/v4/graphql';
        const resolvers = [];
        const fetchImpl = createProviderFetch({
            overrides: { [graphqlUrl]: () => new Promise((resolve) => resolvers.push(resolve)) }
        });
        const { app } = createApp({ fetchImpl });

        const first = app.fetch(request(), baseEnv);
        const second = app.fetch(request(), baseEnv);
        await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
        resolvers.forEach((resolve) => resolve(json(cloudflareResponse())));
        await Promise.all([first, second]);

        expect(resolvers).toHaveLength(1);
        expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/workers/scripts/nexerp/settings'))).toHaveLength(1);
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
        expect(body.providers.cloudflare).toEqual({
            state: 'partial',
            issues: [issue, 'metric_unavailable'],
            requests: null,
            errors: null,
            errorRate: null,
            subrequests: null,
            cpuTimeMs: { p50: null, p99: null },
            byStatus: null,
            settings: { usageModel: 'standard', cpuMs: 50, subrequests: 1000 },
            series: []
        });
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

            expect(body.providers.cloudflare.state).toBe('partial');
            expect(body.providers.cloudflare.issues).toEqual(['provider_invalid_response', 'metric_unavailable']);
            expect(body.providers.cloudflare.requests).toBeNull();
            expect(body.providers.cloudflare.settings).toEqual({ usageModel: 'standard', cpuMs: 50, subrequests: 1000 });
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
        expect(body.providers.cloudflare.state).toBe('partial');
        expect(body.providers.cloudflare.issues).toEqual(['provider_unavailable', 'metric_unavailable']);
        expect(body.providers.cloudflare.requests).toBeNull();
        expect(body.providers.cloudflare.settings).toEqual({ usageModel: 'standard', cpuMs: 50, subrequests: 1000 });
        expect(JSON.stringify(body)).not.toContain('raw-timeout-sentinel');
    });
});
