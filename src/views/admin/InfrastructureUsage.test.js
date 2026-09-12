// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InfrastructureUsage from './InfrastructureUsage.vue';

const getInfrastructureUsage = vi.hoisted(() => vi.fn());
vi.mock('@/services/adminApi', () => ({ useAdminApi: () => ({ getInfrastructureUsage }) }));

const provider = (state, overrides = {}) => ({ state, issues: [], ...overrides });
const usage = (supabase, cloudflare) => ({
    generatedAt: '2026-09-12T03:04:05.000Z',
    range: { key: '24h', start: '2026-09-11T03:04:05.000Z', end: '2026-09-12T03:04:05.000Z' },
    providers: { supabase, cloudflare }
});

const mountView = () =>
    mount(InfrastructureUsage, {
        global: {
            stubs: {
                Button: {
                    props: ['label', 'loading', 'disabled'],
                    inheritAttrs: false,
                    template: '<button v-bind="$attrs" :disabled="disabled || loading">{{ label }}</button>'
                },
                SelectButton: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: '<div role="group"><button data-test="range-7d" @click="$emit(\'update:modelValue\', \'7d\')">7일</button></div>'
                },
                Tag: { props: ['value'], template: '<span>{{ value }}</span>' },
                ProgressSpinner: { template: '<span>loading</span>' }
            }
        }
    });

describe('InfrastructureUsage', () => {
    beforeEach(() => {
        vi.useRealTimers();
        getInfrastructureUsage.mockReset();
    });

    it('renders partial and unconfigured providers with null metrics as unavailable', async () => {
        getInfrastructureUsage.mockResolvedValue(
            usage(
                provider('partial', { issues: ['metric_unavailable'], project: null, services: [], usage: null, disk: null }),
                provider('unconfigured', { issues: ['missing_configuration'], requests: null, errors: null, subrequests: null, series: [] })
            )
        );
        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.text()).toContain('일부 확인');
        expect(wrapper.text()).toContain('설정 필요');
        expect(wrapper.text()).toContain('확인 불가');
        expect(wrapper.text()).toContain('조회된 호출 내역이 없습니다.');
        expect(wrapper.text()).not.toContain('metric_unavailable');
        expect(getInfrastructureUsage).toHaveBeenCalledWith('24h');
    });

    it('retries a failed page request from the rendered action', async () => {
        getInfrastructureUsage
            .mockRejectedValueOnce(new Error('raw-view-sentinel'))
            .mockResolvedValueOnce(usage(provider('unconfigured', { issues: [], project: null, services: [], usage: null, disk: null }), provider('unconfigured', { issues: [], requests: null, errors: null, subrequests: null, series: [] })));
        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.text()).toContain('인프라 사용량을 불러오지 못했습니다.');
        expect(wrapper.text()).not.toContain('raw-view-sentinel');
        const retry = wrapper.findAll('button').find((button) => button.text() === '인프라 사용량 다시 불러오기');
        await retry.trigger('click');
        await flushPromises();

        expect(getInfrastructureUsage).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('Supabase');
        expect(wrapper.text()).toContain('Cloudflare Workers');
    });

    it('renders operational Cloudflare metrics, status breakdown, and allowlisted settings', async () => {
        getInfrastructureUsage.mockResolvedValue(
            usage(
                provider('ok', { project: null, services: [], usage: null, disk: null }),
                provider('partial', {
                    issues: ['metric_unavailable'],
                    requests: 200,
                    errors: 5,
                    errorRate: 2.5,
                    subrequests: 80,
                    cpuTimeUs: { p50: 1250, p99: 9500 },
                    responseBytes: null,
                    seriesComplete: true,
                    byStatus: [{ status: 'exceededResources', requests: 5, errors: 5, subrequests: 1 }],
                    settings: { usageModel: 'standard', cpuMs: 50, subrequests: 1000 },
                    series: [{ datetime: '2026-09-12T01:00:00.000Z', status: 'exceededResources', requests: 5, errors: 5, subrequests: 1 }]
                })
            )
        );
        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.text()).toContain('오류율');
        expect(wrapper.text()).toContain('2.5%');
        expect(wrapper.text()).toContain('CPU P50');
        expect(wrapper.text()).toContain('1.25 ms');
        expect(wrapper.text()).toContain('응답 바이트');
        expect(wrapper.text()).toContain('제공 안 됨');
        expect(wrapper.text()).toContain('상태별 호출');
        expect(wrapper.text()).toContain('exceededResources');
        expect(wrapper.text()).toContain('시간별 운영 이력');
        expect(wrapper.text()).toContain('standard');
        expect(wrapper.text()).toContain('샘플링 기반 운영 지표');
        expect(wrapper.text()).toContain('청구 사용량과 다를 수 있습니다.');
    });

    it('suppresses incomplete Cloudflare detail tables at the collection boundary', async () => {
        getInfrastructureUsage.mockResolvedValue(
            usage(
                provider('ok', { project: null, services: [], usage: null, disk: null }),
                provider('partial', {
                    issues: ['metric_unavailable'],
                    requests: 10000,
                    errors: 25,
                    errorRate: 0.25,
                    subrequests: 400,
                    cpuTimeUs: { p50: 800, p99: 3200 },
                    responseBytes: null,
                    seriesComplete: false,
                    byStatus: null,
                    settings: { usageModel: 'standard', cpuMs: 50, subrequests: 1000 },
                    series: []
                })
            )
        );
        const wrapper = mountView();
        await flushPromises();

        expect(wrapper.text()).toContain('10,000');
        expect(wrapper.text()).toContain('수집 한도에 도달해 상세 이력을 표시할 수 없습니다.');
        expect(wrapper.text()).not.toContain('확인 가능한 상태별 호출이 없습니다.');
        expect(wrapper.text()).not.toContain('조회된 호출 내역이 없습니다.');
    });

    it('does not let a stale range request overwrite the current range state', async () => {
        let resolve24;
        let resolve7;
        getInfrastructureUsage.mockImplementation(
            (range) =>
                new Promise((resolve) => {
                    if (range === '24h') resolve24 = resolve;
                    else resolve7 = resolve;
                })
        );
        const wrapper = mountView();
        await flushPromises();
        await wrapper.get('[data-test="range-7d"]').trigger('click');
        await flushPromises();

        resolve24(usage(provider('ok', { project: null, services: [], usage: { totalRequests: 24 }, disk: null }), provider('ok', { requests: 24, errors: 0, subrequests: 0, series: [] })));
        await flushPromises();
        const staleValueRendered = wrapper.text().includes('24');
        const staleRequestStoppedLoading = wrapper.get('[aria-label="인프라 사용량 새로고침"]').attributes('disabled') === undefined;

        const sevenDayUsage = usage(provider('ok', { project: null, services: [], usage: { totalRequests: 700 }, disk: null }), provider('ok', { requests: 700, errors: 0, subrequests: 0, series: [] }));
        sevenDayUsage.range.key = '7d';
        resolve7(sevenDayUsage);
        await flushPromises();
        expect(staleValueRendered).toBe(false);
        expect(staleRequestStoppedLoading).toBe(false);
        expect(wrapper.text()).toContain('700');
    });

    it('keeps manual refresh disabled for a 60-second cooldown after loading', async () => {
        vi.useFakeTimers();
        try {
            getInfrastructureUsage.mockResolvedValue(usage(provider('unconfigured', { project: null, services: [], usage: null, disk: null }), provider('unconfigured', { requests: null, errors: null, subrequests: null, series: [] })));
            const wrapper = mountView();
            await flushPromises();
            const refresh = wrapper.get('[aria-label="인프라 사용량 새로고침"]');
            expect(refresh.attributes('disabled')).toBeUndefined();

            await refresh.trigger('click');
            await flushPromises();
            expect(refresh.attributes('disabled')).toBeDefined();

            await vi.advanceTimersByTimeAsync(60_000);
            expect(refresh.attributes('disabled')).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
