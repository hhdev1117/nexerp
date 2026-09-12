import { authorizeAdministrator } from './admin';
import { jsonResponse } from './http';
import { createUserSupabaseClient } from './supabase';

const RANGE_CONFIGURATION = Object.freeze({
    '24h': Object.freeze({ durationMs: 24 * 60 * 60 * 1000, interval: '1hr' }),
    '7d': Object.freeze({ durationMs: 7 * 24 * 60 * 60 * 1000, interval: '1day' })
});
const ISSUE_CODES = new Set(['missing_configuration', 'provider_auth_failed', 'provider_forbidden', 'provider_rate_limited', 'provider_unavailable', 'provider_invalid_response', 'metric_unavailable']);
const SERVICE_NAMES = Object.freeze(['auth', 'db', 'pooler', 'realtime', 'rest', 'storage']);
const PROJECT_STATUSES = new Set(['UNKNOWN', 'ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTORING', 'UPGRADING', 'PAUSING', 'RESTORE_FAILED', 'RESTARTING', 'PAUSE_FAILED', 'RESIZING']);
const SERVICE_STATUSES = new Set(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'GOING_DOWN', 'INACTIVE', 'HEALTHY', 'UNHEALTHY', 'UNKNOWN']);
const INVOCATION_STATUSES = Object.freeze(['success', 'clientDisconnected', 'scriptThrewException', 'exceededResources', 'internalError']);
const INVOCATION_STATUS_SET = new Set(INVOCATION_STATUSES);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const REGION_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROJECT_STATUS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const CLOUDFLARE_ACCOUNT_PATTERN = /^[a-f0-9]{32}$/;
const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const CLOUDFLARE_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const CLOUDFLARE_SERIES_LIMIT = 1000;
const CACHE_TTL_MS = 60_000;
const defaultInfrastructureCache = { values: new Map(), inFlight: new Map() };
const CLOUDFLARE_QUERY = `query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      totals: workersInvocationsAdaptive(limit: 1, filter: {scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
      series: workersInvocationsAdaptive(limit: ${CLOUDFLARE_SERIES_LIMIT}, orderBy: [datetime_ASC], filter: {scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}) {
        sum { requests errors subrequests }
        dimensions { datetime status }
      }
    }
  }
}`;

class ProviderFailure extends Error {
    constructor(issue) {
        super(issue);
        this.issue = ISSUE_CODES.has(issue) ? issue : 'provider_unavailable';
    }
}

const invalidRange = () => jsonResponse({ error: { code: 'invalid_range', message: '조회 기간을 확인해 주세요.' } }, { status: 400 });
const isConfiguredText = (value) => typeof value === 'string' && value.trim().length > 0;
const isSafeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isSafeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const uniqueIssues = (issues) => [...new Set(issues.filter((issue) => ISSUE_CODES.has(issue)))];

function issueForStatus(status) {
    if (status === 401) return 'provider_auth_failed';
    if (status === 403) return 'provider_forbidden';
    if (status === 429) return 'provider_rate_limited';
    return status >= 500 ? 'provider_unavailable' : 'provider_invalid_response';
}

async function fetchJson(fetchImpl, url, { method = 'GET', headers, body, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body }), signal: controller.signal });
        if (!response?.ok) throw new ProviderFailure(issueForStatus(response?.status ?? 0));
        try {
            return await response.json();
        } catch {
            throw new ProviderFailure('provider_invalid_response');
        }
    } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('provider_unavailable');
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchConnectivity(fetchImpl, url, { headers, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
        if (!response?.ok) throw new ProviderFailure(issueForStatus(response?.status ?? 0));
        return true;
    } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('provider_unavailable');
    } finally {
        clearTimeout(timeout);
    }
}

function projectOrigin(value) {
    if (!isConfiguredText(value)) return null;
    try {
        const url = new URL(value);
        const [ref, ...suffix] = url.hostname.split('.');
        const exactHost = suffix.join('.') === 'supabase.co';
        if (url.protocol !== 'https:' || url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || !exactHost || !PROJECT_REF_PATTERN.test(ref)) return null;
        return { ref, origin: url.origin };
    } catch {
        return null;
    }
}

function normalizeProject(value) {
    if (!value || typeof value !== 'object') throw new ProviderFailure('provider_invalid_response');
    const { name, region, status } = value;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || typeof region !== 'string' || !REGION_PATTERN.test(region) || typeof status !== 'string' || !PROJECT_STATUS_PATTERN.test(status)) {
        throw new ProviderFailure('provider_invalid_response');
    }
    return { name: name.trim(), region, status: PROJECT_STATUSES.has(status) ? status : 'UNKNOWN' };
}

function normalizeHealth(value) {
    if (!Array.isArray(value)) throw new ProviderFailure('provider_invalid_response');
    const byName = new Map();
    for (const service of value) {
        if (!service || !SERVICE_NAMES.includes(service.name) || typeof service.healthy !== 'boolean' || !SERVICE_STATUSES.has(service.status) || byName.has(service.name)) {
            throw new ProviderFailure('provider_invalid_response');
        }
        byName.set(service.name, { name: service.name, healthy: service.healthy, status: service.status });
    }
    if (byName.size !== SERVICE_NAMES.length) throw new ProviderFailure('provider_invalid_response');
    return SERVICE_NAMES.map((name) => byName.get(name));
}

function normalizeUsage(value) {
    if (!value || !Array.isArray(value.result) || value.error) throw new ProviderFailure('provider_invalid_response');
    const totals = { authRequests: 0, realtimeRequests: 0, restRequests: 0, storageRequests: 0 };
    for (const row of value.result) {
        const fields = [row?.total_auth_requests, row?.total_realtime_requests, row?.total_rest_requests, row?.total_storage_requests];
        if (!fields.every(isSafeCount)) throw new ProviderFailure('provider_invalid_response');
        totals.authRequests += fields[0];
        totals.realtimeRequests += fields[1];
        totals.restRequests += fields[2];
        totals.storageRequests += fields[3];
    }
    return { totalRequests: totals.authRequests + totals.realtimeRequests + totals.restRequests + totals.storageRequests, ...totals };
}

function normalizeDisk(utilization, configuration) {
    const metrics = utilization?.metrics;
    const attributes = configuration?.attributes;
    const numericValues = [metrics?.fs_size_bytes, metrics?.fs_avail_bytes, metrics?.fs_used_bytes, attributes?.size_gb, attributes?.iops];
    const throughput = attributes?.throughput_mibps;
    if (!numericValues.every(isSafeNumber) || (throughput !== undefined && throughput !== null && !isSafeNumber(throughput)) || !['gp3', 'io2'].includes(attributes?.type)) {
        throw new ProviderFailure('provider_invalid_response');
    }
    return {
        sizeBytes: metrics.fs_size_bytes,
        availableBytes: metrics.fs_avail_bytes,
        usedBytes: metrics.fs_used_bytes,
        provisionedSizeGb: attributes.size_gb,
        iops: attributes.iops,
        throughputMibps: throughput ?? null,
        type: attributes.type
    };
}

const unavailableSupabase = (issues) => ({ state: 'unavailable', issues: uniqueIssues([...issues, 'metric_unavailable']), project: null, services: [], usage: null, disk: null });
const unconfiguredSupabase = () => ({ state: 'unconfigured', issues: ['missing_configuration', 'metric_unavailable'], project: null, services: [], usage: null, disk: null });

async function collectSupabase(env, range, fetchImpl, timeoutMs) {
    const project = projectOrigin(env.SUPABASE_URL);
    if (!project) return unconfiguredSupabase();

    if (!isConfiguredText(env.SUPABASE_MANAGEMENT_TOKEN)) {
        if (!isConfiguredText(env.SUPABASE_PUBLISHABLE_KEY)) return unconfiguredSupabase();
        try {
            await fetchConnectivity(fetchImpl, `${project.origin}/auth/v1/health`, {
                headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' },
                timeoutMs
            });
            return {
                state: 'partial',
                issues: ['missing_configuration', 'metric_unavailable'],
                project: null,
                services: [{ name: 'auth', healthy: true, status: 'reachable' }],
                usage: null,
                disk: null
            };
        } catch (error) {
            return {
                state: 'partial',
                issues: uniqueIssues(['missing_configuration', error?.issue || 'provider_unavailable', 'metric_unavailable']),
                project: null,
                services: [{ name: 'auth', healthy: false, status: 'unreachable' }],
                usage: null,
                disk: null
            };
        }
    }

    const base = `https://api.supabase.com/v1/projects/${project.ref}`;
    const headers = { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, Accept: 'application/json' };
    const healthQuery = new URLSearchParams({ services: SERVICE_NAMES.join(','), timeout_ms: '2000' });
    const usageQuery = new URLSearchParams({ interval: range.interval });
    const results = await Promise.allSettled([
        fetchJson(fetchImpl, base, { headers, timeoutMs }),
        fetchJson(fetchImpl, `${base}/health?${healthQuery}`, { headers, timeoutMs }),
        fetchJson(fetchImpl, `${base}/analytics/endpoints/usage.api-counts?${usageQuery}`, { headers, timeoutMs }),
        fetchJson(fetchImpl, `${base}/config/disk/util`, { headers, timeoutMs }),
        fetchJson(fetchImpl, `${base}/config/disk`, { headers, timeoutMs })
    ]);

    const issues = [];
    const normalized = { project: null, services: [], usage: null, disk: null };
    const normalizeSettled = (result, normalize) => {
        if (result.status === 'rejected') {
            issues.push(result.reason?.issue || 'provider_unavailable');
            return null;
        }
        try {
            return normalize(result.value);
        } catch (error) {
            issues.push(error?.issue || 'provider_invalid_response');
            return null;
        }
    };

    normalized.project = normalizeSettled(results[0], normalizeProject);
    normalized.services = normalizeSettled(results[1], normalizeHealth) || [];
    normalized.usage = normalizeSettled(results[2], normalizeUsage);
    if (results[3].status === 'fulfilled' && results[4].status === 'fulfilled') {
        try {
            normalized.disk = normalizeDisk(results[3].value, results[4].value);
        } catch (error) {
            issues.push(error?.issue || 'provider_invalid_response');
        }
    } else {
        for (const result of [results[3], results[4]]) if (result.status === 'rejected') issues.push(result.reason?.issue || 'provider_unavailable');
    }

    const availableComponents = [normalized.project, normalized.services.length ? normalized.services : null, normalized.usage, normalized.disk].filter(Boolean).length;
    if (availableComponents === 0) return unavailableSupabase(issues);
    if (availableComponents < 4) issues.push('metric_unavailable');
    const hasUnhealthyService = normalized.services.some((service) => !service.healthy);
    return { state: issues.length || hasUnhealthyService ? 'partial' : 'ok', issues: uniqueIssues(issues), ...normalized };
}

function addCounts(target, values) {
    const next = [target.requests + values[0], target.errors + values[1], target.subrequests + values[2]];
    if (!next.every(isSafeCount)) throw new ProviderFailure('provider_invalid_response');
    [target.requests, target.errors, target.subrequests] = next;
}

function normalizeCloudflareAnalytics(value) {
    if (!value || (Array.isArray(value.errors) && value.errors.length) || value.errors !== null) throw new ProviderFailure('provider_invalid_response');
    const accounts = value.data?.viewer?.accounts;
    const totalsRows = accounts?.[0]?.totals;
    const seriesRows = accounts?.[0]?.series;
    if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(totalsRows) || totalsRows.length !== 1 || !Array.isArray(seriesRows)) throw new ProviderFailure('provider_invalid_response');
    const totalValues = [totalsRows[0]?.sum?.requests, totalsRows[0]?.sum?.errors, totalsRows[0]?.sum?.subrequests];
    if (!totalValues.every(isSafeCount)) throw new ProviderFailure('provider_invalid_response');
    const quantiles = totalsRows[0]?.quantiles;
    const cpuValues = [quantiles?.cpuTimeP50 ?? null, quantiles?.cpuTimeP99 ?? null];
    if (!cpuValues.every((metric) => metric === null || isSafeNumber(metric))) throw new ProviderFailure('provider_invalid_response');

    const hourly = new Map();
    const statuses = new Map();
    for (const row of seriesRows) {
        const datetime = new Date(row?.dimensions?.datetime);
        const status = row?.dimensions?.status;
        const values = [row?.sum?.requests, row?.sum?.errors, row?.sum?.subrequests];
        if (Number.isNaN(datetime.getTime()) || !INVOCATION_STATUS_SET.has(status) || !values.every(isSafeCount)) throw new ProviderFailure('provider_invalid_response');
        datetime.setUTCMinutes(0, 0, 0);
        const hour = datetime.toISOString();
        const hourKey = `${hour}:${status}`;
        if (!hourly.has(hourKey)) hourly.set(hourKey, { datetime: hour, status, requests: 0, errors: 0, subrequests: 0 });
        if (!statuses.has(status)) statuses.set(status, { status, requests: 0, errors: 0, subrequests: 0 });
        addCounts(hourly.get(hourKey), values);
        addCounts(statuses.get(status), values);
    }

    const statusOrder = new Map(INVOCATION_STATUSES.map((status, index) => [status, index]));
    const series = [...hourly.values()].sort((left, right) => left.datetime.localeCompare(right.datetime) || statusOrder.get(left.status) - statusOrder.get(right.status));
    const byStatus = [...statuses.values()].sort((left, right) => statusOrder.get(left.status) - statusOrder.get(right.status));
    const seriesComplete = seriesRows.length < CLOUDFLARE_SERIES_LIMIT;
    const issues = ['metric_unavailable'];
    return {
        state: issues.length ? 'partial' : 'ok',
        issues,
        requests: totalValues[0],
        errors: totalValues[1],
        errorRate: totalValues[0] === 0 ? null : (totalValues[1] / totalValues[0]) * 100,
        subrequests: totalValues[2],
        cpuTimeUs: { p50: cpuValues[0], p99: cpuValues[1] },
        responseBytes: null,
        seriesComplete,
        byStatus: seriesComplete ? byStatus : null,
        series: seriesComplete ? series : []
    };
}

function normalizeCloudflareSettings(value) {
    if (!value || value.success !== true || !Array.isArray(value.errors) || value.errors.length || !value.result || typeof value.result !== 'object') {
        throw new ProviderFailure('provider_invalid_response');
    }
    const usageModel = value.result.usage_model ?? null;
    const cpuMs = value.result.limits?.cpu_ms ?? null;
    const subrequests = value.result.limits?.subrequests ?? null;
    if ((usageModel !== null && !['standard', 'bundled', 'unbound'].includes(usageModel)) || (cpuMs !== null && !isSafeNumber(cpuMs)) || (subrequests !== null && !isSafeCount(subrequests))) {
        throw new ProviderFailure('provider_invalid_response');
    }
    return { usageModel, cpuMs, subrequests };
}

const emptyCloudflare = () => ({
    requests: null,
    errors: null,
    errorRate: null,
    subrequests: null,
    cpuTimeUs: { p50: null, p99: null },
    responseBytes: null,
    seriesComplete: null,
    byStatus: null,
    settings: null,
    series: []
});
const unavailableCloudflare = (issues) => ({ state: 'unavailable', issues: uniqueIssues([...(Array.isArray(issues) ? issues : [issues]), 'metric_unavailable']), ...emptyCloudflare() });
const unconfiguredCloudflare = () => ({ state: 'unconfigured', issues: ['missing_configuration', 'metric_unavailable'], ...emptyCloudflare() });

async function collectCloudflare(env, window, fetchImpl, timeoutMs) {
    if (!isConfiguredText(env.CLOUDFLARE_API_TOKEN) || !CLOUDFLARE_ACCOUNT_PATTERN.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !WORKER_NAME_PATTERN.test(env.CLOUDFLARE_WORKER_NAME || '')) {
        return unconfiguredCloudflare();
    }
    const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, Accept: 'application/json' };
    const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${env.CLOUDFLARE_WORKER_NAME}/settings`;
    const results = await Promise.allSettled([
        fetchJson(fetchImpl, CLOUDFLARE_GRAPHQL_URL, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: CLOUDFLARE_QUERY,
                variables: {
                    accountTag: env.CLOUDFLARE_ACCOUNT_ID,
                    datetimeStart: window.start,
                    datetimeEnd: window.end,
                    scriptName: env.CLOUDFLARE_WORKER_NAME
                }
            }),
            timeoutMs
        }),
        fetchJson(fetchImpl, settingsUrl, { headers, timeoutMs })
    ]);

    const issues = [];
    const normalizeSettled = (result, normalize) => {
        if (result.status === 'rejected') {
            issues.push(result.reason?.issue || 'provider_unavailable');
            return null;
        }
        try {
            return normalize(result.value);
        } catch (error) {
            issues.push(error?.issue || 'provider_invalid_response');
            return null;
        }
    };
    const analytics = normalizeSettled(results[0], normalizeCloudflareAnalytics);
    const settings = normalizeSettled(results[1], normalizeCloudflareSettings);
    if (analytics?.issues?.length) issues.push(...analytics.issues);
    if (!analytics || !settings) issues.push('metric_unavailable');
    if (!analytics && !settings) return unavailableCloudflare(issues);
    const metrics = analytics
        ? {
              requests: analytics.requests,
              errors: analytics.errors,
              errorRate: analytics.errorRate,
              subrequests: analytics.subrequests,
              cpuTimeUs: analytics.cpuTimeUs,
              responseBytes: analytics.responseBytes,
              seriesComplete: analytics.seriesComplete,
              byStatus: analytics.byStatus,
              series: analytics.series
          }
        : emptyCloudflare();
    return {
        ...metrics,
        settings,
        state: issues.length ? 'partial' : 'ok',
        issues: uniqueIssues(issues)
    };
}

async function collectInfrastructureUsage(env, rangeConfig, window, fetchImpl, timeoutMs) {
    const providers = await Promise.allSettled([collectSupabase(env, rangeConfig, fetchImpl, timeoutMs), collectCloudflare(env, window, fetchImpl, timeoutMs)]);
    return {
        generatedAt: window.end,
        range: window,
        providers: {
            supabase: providers[0].status === 'fulfilled' ? providers[0].value : unavailableSupabase(['provider_unavailable']),
            cloudflare: providers[1].status === 'fulfilled' ? providers[1].value : unavailableCloudflare('provider_unavailable')
        }
    };
}

export async function handleInfrastructureUsageRequest(
    request,
    env,
    { createSupabaseClient = createUserSupabaseClient, fetchImpl = fetch, now = () => new Date(), timeoutMs = 8000, cache = defaultInfrastructureCache, cacheTtlMs = CACHE_TTL_MS } = {}
) {
    const authorization = await authorizeAdministrator(request, env, createSupabaseClient);
    if (authorization.response) return authorization.response;

    const values = new URL(request.url).searchParams.getAll('range');
    if (values.length !== 1 || !Object.hasOwn(RANGE_CONFIGURATION, values[0])) return invalidRange();

    const rangeKey = values[0];
    const rangeConfig = RANGE_CONFIGURATION[rangeKey];
    const endDate = new Date(now());
    if (Number.isNaN(endDate.getTime())) return invalidRange();
    const window = { key: rangeKey, start: new Date(endDate.getTime() - rangeConfig.durationMs).toISOString(), end: endDate.toISOString() };
    const cached = cache.values.get(rangeKey);
    if (cached && cached.expiresAt > endDate.getTime()) return jsonResponse(cached.value);
    if (cached) cache.values.delete(rangeKey);

    let pending = cache.inFlight.get(rangeKey);
    if (!pending) {
        pending = Promise.resolve().then(() => collectInfrastructureUsage(env, rangeConfig, window, fetchImpl, timeoutMs));
        cache.inFlight.set(rangeKey, pending);
    }
    try {
        const value = await pending;
        cache.values.set(rangeKey, { expiresAt: endDate.getTime() + cacheTtlMs, value });
        return jsonResponse(value);
    } finally {
        if (cache.inFlight.get(rangeKey) === pending) cache.inFlight.delete(rangeKey);
    }
}
