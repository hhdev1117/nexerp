// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { expect, it } from 'vitest';
import { numberParam, useQueryState } from './useQueryState';

const Harness = {
    template: '<div>{{ keyword }}|{{ status }}|{{ page }}</div>',
    setup() {
        return useQueryState({
            keyword: { fallback: '' },
            status: { fallback: null },
            page: numberParam(1)
        });
    }
};

const mountHarness = async (initialPath) => {
    const router = createRouter({ history: createWebHistory(), routes: [{ path: '/list', component: Harness }] });
    router.push(initialPath);
    await router.isReady();
    const wrapper = mount(Harness, { global: { plugins: [router] } });
    await flushPromises();
    return { wrapper, router };
};

it('restores filters and paging from the url', async () => {
    const { wrapper } = await mountHarness('/list?keyword=%EC%84%B8%EB%A6%BC&status=approved&page=3');
    expect(wrapper.vm.keyword).toBe('세림');
    expect(wrapper.vm.status).toBe('approved');
    expect(wrapper.vm.page).toBe(3);
});

it('writes changed filters to the url and omits default values', async () => {
    const { wrapper, router } = await mountHarness('/list');
    wrapper.vm.keyword = '세림';
    wrapper.vm.page = 2;
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ keyword: '세림', page: '2' });

    wrapper.vm.keyword = '';
    wrapper.vm.page = 1;
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
});

it('follows browser navigation back to an earlier filter', async () => {
    const { wrapper, router } = await mountHarness('/list');
    wrapper.vm.status = 'approved';
    await flushPromises();

    await router.push('/list?status=rejected');
    await flushPromises();
    expect(wrapper.vm.status).toBe('rejected');
});

it('clears every field back to its fallback', async () => {
    const { wrapper, router } = await mountHarness('/list?keyword=abc&status=approved&page=4');
    wrapper.vm.reset();
    await flushPromises();
    expect(wrapper.vm.keyword).toBe('');
    expect(wrapper.vm.status).toBeNull();
    expect(wrapper.vm.page).toBe(1);
    expect(router.currentRoute.value.query).toEqual({});
});

it('does not let an in-flight url write restore state that changed meanwhile', async () => {
    const { wrapper, router } = await mountHarness('/list');
    wrapper.vm.status = 'approved';
    wrapper.vm.status = null;
    await flushPromises();
    expect(wrapper.vm.status).toBeNull();
    expect(router.currentRoute.value.query).toEqual({});
});
