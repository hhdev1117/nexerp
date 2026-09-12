// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import App from '../App.vue';

const pwa = vi.hoisted(() => ({ needRefresh: null, updateServiceWorker: vi.fn() }));
vi.mock('virtual:pwa-register/vue', () => ({ useRegisterSW: () => pwa }));

const mountApp = () =>
    mount(App, {
        global: {
            stubs: {
                RouterView: { template: '<main>업무 화면</main>' },
                Button: { props: ['label', 'disabled', 'loading'], template: '<button :disabled="disabled || loading">{{ label }}</button>' }
            }
        }
    });

describe('PWA update prompt', () => {
    beforeEach(() => {
        pwa.needRefresh = ref(false);
        pwa.updateServiceWorker.mockReset().mockResolvedValue(undefined);
    });

    it('shows no prompt until an update waits and never reloads automatically', async () => {
        const wrapper = mountApp();
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        pwa.needRefresh.value = true;
        await flushPromises();
        expect(wrapper.get('[role="status"]').text()).toContain('새 버전이 준비되었습니다.');
        expect(wrapper.text()).toContain('업무 화면');
        expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
    });

    it('activates a waiting version only when the Korean update button is clicked', async () => {
        pwa.needRefresh.value = true;
        const wrapper = mountApp();
        const button = wrapper.findAll('button').find((entry) => entry.text() === '업데이트');
        expect(button).toBeDefined();
        await button.trigger('click');
        expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true);
    });

    it('lets the user defer the update without activating it', async () => {
        pwa.needRefresh.value = true;
        const wrapper = mountApp();
        const button = wrapper.findAll('button').find((entry) => entry.text() === '나중에');
        expect(button).toBeDefined();
        await button.trigger('click');
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
    });

    it('keeps a retry action and a safe message when update activation fails', async () => {
        pwa.needRefresh.value = true;
        pwa.updateServiceWorker.mockRejectedValueOnce(new Error('private-update-failure'));
        const wrapper = mountApp();
        const button = wrapper.findAll('button').find((entry) => entry.text() === '업데이트');
        expect(button).toBeDefined();
        await button.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('업데이트하지 못했습니다. 다시 시도해 주세요.');
        expect(wrapper.text()).not.toContain('private-update-failure');
        expect(button.attributes('disabled')).toBeUndefined();
    });
});
