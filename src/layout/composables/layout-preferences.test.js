// @vitest-environment jsdom

import Lara from '@primeuix/themes/lara';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayout } from './layout';

const themeHarness = vi.hoisted(() => {
    const builder = {};
    builder.preset = vi.fn(() => builder);
    builder.surfacePalette = vi.fn(() => builder);
    builder.use = vi.fn(() => builder);
    return { builder, transaction: vi.fn(() => builder) };
});

vi.mock('@primeuix/themes', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, $t: themeHarness.transaction };
});

describe('account layout preferences', () => {
    beforeEach(() => {
        themeHarness.transaction.mockClear();
        themeHarness.builder.preset.mockClear();
        themeHarness.builder.surfacePalette.mockClear();
        themeHarness.builder.use.mockClear();
        document.documentElement.classList.remove('app-dark');

        const { layoutConfig, layoutState } = useLayout();
        Object.assign(layoutConfig, { preset: 'Aura', primary: 'emerald', surface: null, darkTheme: false, menuMode: 'static' });
        Object.assign(layoutState, { staticMenuInactive: false, overlayMenuActive: false, mobileMenuActive: false, sidebarExpanded: false, menuHoverActive: false });
    });

    it('restores every valid preference and applies the selected theme deterministically', () => {
        const layout = useLayout();

        expect(typeof layout.applyLayoutPreferences).toBe('function');
        layout.applyLayoutPreferences({ preset: 'Lara', primary: 'blue', surface: 'stone', darkTheme: true, menuMode: 'overlay' });

        expect({ ...layout.layoutConfig }).toEqual({ preset: 'Lara', primary: 'blue', surface: 'stone', darkTheme: true, menuMode: 'overlay' });
        expect(document.documentElement.classList.contains('app-dark')).toBe(true);
        expect(themeHarness.transaction).toHaveBeenCalledTimes(1);
        expect(themeHarness.builder.preset).toHaveBeenNthCalledWith(1, Lara);
        expect(themeHarness.builder.preset).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                semantic: expect.objectContaining({
                    colorScheme: expect.objectContaining({
                        dark: expect.objectContaining({
                            primary: expect.objectContaining({ contrastColor: '{surface.950}' }),
                            highlight: expect.objectContaining({ color: '{primary.200}', focusColor: '{primary.100}' })
                        })
                    })
                })
            })
        );
        expect(themeHarness.builder.surfacePalette).toHaveBeenCalledWith(expect.objectContaining({ 500: '#78716c' }));
        expect(themeHarness.builder.use).toHaveBeenCalledWith({ useDefaultOptions: true });
    });

    it('falls back to safe defaults for malformed or unsupported stored values', () => {
        const layout = useLayout();
        document.documentElement.classList.add('app-dark');

        expect(typeof layout.applyLayoutPreferences).toBe('function');
        const applied = layout.applyLayoutPreferences({ preset: 'Unknown', primary: '<script>', surface: [], darkTheme: 'yes', menuMode: 'floating', ignored: 'value' });

        expect(applied).toEqual({ preset: 'Aura', primary: 'emerald', surface: null, darkTheme: false, menuMode: 'static' });
        expect(layout.getLayoutPreferences()).toEqual(applied);
        expect(document.documentElement.classList.contains('app-dark')).toBe(false);
    });

    it('resets account preferences and transient navigation state without toggling the dark class blindly', () => {
        const layout = useLayout();
        layout.layoutConfig.darkTheme = true;
        layout.layoutConfig.menuMode = 'overlay';
        layout.layoutState.overlayMenuActive = true;
        layout.layoutState.mobileMenuActive = true;
        layout.layoutState.profileSidebarVisible = true;
        layout.layoutState.configSidebarVisible = true;
        layout.layoutState.activeMenuItem = 'finance.summary';
        layout.layoutState.activePath = '/finance/summary';
        document.documentElement.classList.add('app-dark');

        expect(typeof layout.resetLayoutPreferences).toBe('function');
        layout.resetLayoutPreferences();

        expect(layout.getLayoutPreferences()).toEqual({ preset: 'Aura', primary: 'emerald', surface: null, darkTheme: false, menuMode: 'static' });
        expect(layout.layoutState.overlayMenuActive).toBe(false);
        expect(layout.layoutState.mobileMenuActive).toBe(false);
        expect(layout.layoutState.profileSidebarVisible).toBe(false);
        expect(layout.layoutState.configSidebarVisible).toBe(false);
        expect(layout.layoutState.activeMenuItem).toBeNull();
        expect(layout.layoutState.activePath).toBeNull();
        expect(document.documentElement.classList.contains('app-dark')).toBe(false);
    });
});
