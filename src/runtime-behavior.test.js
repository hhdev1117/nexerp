// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppLayout from './layout/AppLayout.vue';
import { useLayout } from './layout/composables/layout';
import { useErpStore } from './stores/erp';
import GenericModule from './views/erp/GenericModule.vue';
import SalesOrders from './views/erp/SalesOrders.vue';

const mountedWrappers = [];
const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

const mountWithPrimeVue = (component, options = {}) => {
    const wrapper = mount(component, {
        attachTo: document.body,
        ...options,
        global: {
            ...options.global,
            plugins: [PrimeVue, ToastService, ConfirmationService, ...(options.global?.plugins || [])]
        }
    });
    mountedWrappers.push(wrapper);
    return wrapper;
};

const createTestRouter = (path = '/') => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/sales/orders', component: { template: '<div />' }, meta: { title: '수주 관리' } },
            {
                path: '/sales/quotes',
                component: { template: '<div />' },
                meta: { title: '견적 관리', description: '고객 견적과 유효기간을 관리합니다.', icon: 'pi pi-file-edit' }
            }
        ]
    });
    return router
        .push(path)
        .then(() => router.isReady())
        .then(() => router);
};

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({
            matches: false,
            media: '',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() {
                return false;
            }
        })
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            return document.body;
        }
    });
});

afterEach(async () => {
    while (mountedWrappers.length) mountedWrappers.pop().unmount();
    document.body.innerHTML = '';
    await useErpStore().resetDemoState();

    const { layoutConfig, layoutState } = useLayout();
    layoutConfig.menuMode = 'static';
    layoutState.overlayMenuActive = false;
    layoutState.mobileMenuActive = false;
    if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent);
});

describe('mounted ERP behavior', () => {
    it('passes required and error-description semantics to the InputNumber spinbutton', async () => {
        const router = await createTestRouter('/sales/orders');
        const wrapper = mountWithPrimeVue(SalesOrders, { global: { plugins: [router] } });
        await wrapper
            .findAll('button')
            .find((button) => button.text().includes('신규 수주'))
            .trigger('click');
        await flushPromises();

        const amountInput = document.querySelector('#amount');
        expect(amountInput).not.toBeNull();
        expect(amountInput.required).toBe(true);
        expect(amountInput.getAttribute('aria-required')).toBe('true');
        expect(amountInput.getAttribute('aria-describedby')).toBe('amount-error');
    });

    it('runs custom generic form validation on an empty submission', async () => {
        const router = await createTestRouter('/sales/quotes');
        const wrapper = mountWithPrimeVue(GenericModule, { global: { plugins: [router] } });
        await wrapper
            .findAll('button')
            .find((button) => button.text().includes('신규 등록'))
            .trigger('click');
        await flushPromises();

        const form = document.querySelector('form');
        expect(form.noValidate).toBe(true);
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(document.querySelector('#generic-subject-error')?.textContent).toContain('업무명은 필수입니다.');
        expect(document.activeElement?.id).toBe('generic-subject');
    });

    it('focuses and dismisses the desktop overlay menu from the keyboard', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
        const router = await createTestRouter();
        const { layoutConfig, layoutState } = useLayout();
        layoutConfig.menuMode = 'overlay';

        mountWithPrimeVue(AppLayout, {
            global: {
                plugins: [router],
                stubs: {
                    AppTopbar: { template: '<button class="layout-menu-button">메뉴</button>' },
                    AppSidebar: { template: '<aside class="layout-sidebar"><a id="overlay-menu-link" href="#">메뉴 항목</a></aside>' },
                    AppFooter: true,
                    RouterView: true,
                    Toast: true
                }
            }
        });

        const trigger = document.querySelector('.layout-menu-button');
        trigger.focus();
        layoutState.overlayMenuActive = true;
        await nextTick();
        await nextTick();
        expect(document.activeElement?.id).toBe('overlay-menu-link');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nextTick();
        await nextTick();
        expect(layoutState.overlayMenuActive).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });
});
