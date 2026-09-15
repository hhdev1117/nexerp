// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import App from './App.vue';

const harness = vi.hoisted(() => ({ auth: {}, layout: { applyLayoutPreferences: vi.fn(), resetLayoutPreferences: vi.fn() } }));
const auth = harness.auth;
const layout = harness.layout;
auth.user = ref(null);
auth.profile = ref(null);

vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }));
vi.mock('@/layout/composables/layout', () => ({ useLayout: () => layout }));
vi.mock('@/pwa/PwaUpdatePrompt.vue', () => ({ default: { template: '<div />' } }));

describe('application UI preference hydration', () => {
    beforeEach(() => {
        auth.user.value = null;
        auth.profile.value = null;
        layout.applyLayoutPreferences.mockReset();
        layout.resetLayoutPreferences.mockReset();
    });

    it('resets anonymous state and applies each active account own stored preferences', async () => {
        const wrapper = mount(App, { global: { stubs: { RouterView: true } } });

        expect(layout.resetLayoutPreferences).toHaveBeenCalledTimes(1);

        const firstPreferences = { preset: 'Lara', primary: 'blue', surface: 'stone', darkTheme: true, menuMode: 'overlay' };
        auth.user.value = { id: 'user-a' };
        auth.profile.value = { id: 'user-a', is_active: true, ui_preferences: firstPreferences };
        await flushPromises();
        expect(layout.applyLayoutPreferences).toHaveBeenLastCalledWith(firstPreferences);

        auth.profile.value = null;
        await flushPromises();
        expect(layout.resetLayoutPreferences).toHaveBeenCalledTimes(1);

        auth.profile.value = { id: 'user-a', is_active: true, ui_preferences: firstPreferences };
        await flushPromises();
        expect(layout.applyLayoutPreferences).toHaveBeenCalledTimes(1);

        auth.user.value = { id: 'user-b' };
        auth.profile.value = null;
        await flushPromises();
        expect(layout.resetLayoutPreferences).toHaveBeenCalledTimes(2);

        const secondPreferences = { preset: 'Nora', primary: 'rose', surface: 'zinc', darkTheme: false, menuMode: 'static' };
        auth.profile.value = { id: 'user-b', is_active: true, ui_preferences: secondPreferences };
        await flushPromises();
        expect(layout.applyLayoutPreferences).toHaveBeenLastCalledWith(secondPreferences);

        auth.profile.value = { id: 'user-b', is_active: false, ui_preferences: firstPreferences };
        await flushPromises();
        expect(layout.resetLayoutPreferences).toHaveBeenCalledTimes(3);

        wrapper.unmount();
    });
});
