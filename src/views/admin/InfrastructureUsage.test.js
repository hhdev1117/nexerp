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
                Button: { props: ['label'], inheritAttrs: false, template: '<button v-bind="$attrs">{{ label }}</button>' },
                SelectButton: { template: '<div role="group"></div>' },
                Tag: { props: ['value'], template: '<span>{{ value }}</span>' },
                ProgressSpinner: { template: '<span>loading</span>' }
            }
        }
    });

describe('InfrastructureUsage', () => {
    beforeEach(() => getInfrastructureUsage.mockReset());

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
            .mockResolvedValueOnce(
                usage(
                    provider('unconfigured', { issues: [], project: null, services: [], usage: null, disk: null }),
                    provider('unconfigured', { issues: [], requests: null, errors: null, subrequests: null, series: [] })
                )
            );
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
});
