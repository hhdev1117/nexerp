import { computed, reactive } from 'vue';
import { applyPrimeTheme, DEFAULT_LAYOUT_PREFERENCES, normalizeLayoutPreferences, presetOptions, primaryColors, surfaces } from '@/theme/layoutTheme';

const layoutConfig = reactive({ ...DEFAULT_LAYOUT_PREFERENCES });

const layoutState = reactive({
    staticMenuInactive: false,
    overlayMenuActive: false,
    profileSidebarVisible: false,
    configSidebarVisible: false,
    sidebarExpanded: false,
    menuHoverActive: false,
    mobileMenuActive: false,
    activeMenuItem: null,
    activePath: null
});

export function useLayout() {
    const toggleDarkMode = () => {
        if (!document.startViewTransition) {
            executeDarkModeToggle();
            return Promise.resolve();
        }

        const transition = document.startViewTransition(() => executeDarkModeToggle());
        return transition?.updateCallbackDone || Promise.resolve();
    };

    const executeDarkModeToggle = () => {
        layoutConfig.darkTheme = !layoutConfig.darkTheme;
        document.documentElement.classList.toggle('app-dark', layoutConfig.darkTheme);
    };

    const resetMenuPresentationState = () => {
        layoutState.staticMenuInactive = false;
        layoutState.overlayMenuActive = false;
        layoutState.mobileMenuActive = false;
        layoutState.sidebarExpanded = false;
        layoutState.menuHoverActive = false;
        layoutState.anchored = false;
    };

    const resetTransientLayoutState = () => {
        resetMenuPresentationState();
        layoutState.profileSidebarVisible = false;
        layoutState.configSidebarVisible = false;
        layoutState.activeMenuItem = null;
        layoutState.activePath = null;
    };

    const getLayoutPreferences = () => normalizeLayoutPreferences(layoutConfig);

    const applyLayoutPreferences = (preferences) => {
        const normalized = normalizeLayoutPreferences(preferences);
        Object.assign(layoutConfig, normalized);
        document.documentElement.classList.toggle('app-dark', normalized.darkTheme);
        resetTransientLayoutState();
        applyPrimeTheme(normalized);
        return { ...normalized };
    };

    const resetLayoutPreferences = () => applyLayoutPreferences(DEFAULT_LAYOUT_PREFERENCES);

    const updatePrimaryColor = (name) => {
        const normalized = normalizeLayoutPreferences({ ...getLayoutPreferences(), primary: name });
        layoutConfig.primary = normalized.primary;
        applyPrimeTheme(normalized);
    };

    const updateSurfaceColor = (name) => {
        const normalized = normalizeLayoutPreferences({ ...getLayoutPreferences(), surface: name });
        layoutConfig.surface = normalized.surface;
        applyPrimeTheme(normalized);
    };

    const changePreset = (name) => {
        const normalized = normalizeLayoutPreferences({ ...getLayoutPreferences(), preset: name });
        layoutConfig.preset = normalized.preset;
        applyPrimeTheme(normalized);
    };

    const toggleMenu = () => {
        if (isDesktop()) {
            if (layoutConfig.menuMode === 'static') {
                layoutState.staticMenuInactive = !layoutState.staticMenuInactive;
            }

            if (layoutConfig.menuMode === 'overlay') {
                layoutState.overlayMenuActive = !layoutState.overlayMenuActive;
            }
        } else {
            layoutState.mobileMenuActive = !layoutState.mobileMenuActive;
        }
    };

    const toggleConfigSidebar = () => {
        layoutState.configSidebarVisible = !layoutState.configSidebarVisible;
    };

    const hideMobileMenu = () => {
        layoutState.mobileMenuActive = false;
    };

    const changeMenuMode = (eventOrValue) => {
        const value = typeof eventOrValue === 'string' ? eventOrValue : eventOrValue?.value;
        layoutConfig.menuMode = normalizeLayoutPreferences({ ...getLayoutPreferences(), menuMode: value }).menuMode;
        resetMenuPresentationState();
    };

    const isDarkTheme = computed(() => layoutConfig.darkTheme);
    const isDesktop = () => window.innerWidth > 991;

    const hasOpenOverlay = computed(() => layoutState.overlayMenuActive);

    return {
        layoutConfig,
        layoutState,
        isDarkTheme,
        toggleDarkMode,
        applyLayoutPreferences,
        resetLayoutPreferences,
        getLayoutPreferences,
        updatePrimaryColor,
        updateSurfaceColor,
        changePreset,
        toggleConfigSidebar,
        toggleMenu,
        hideMobileMenu,
        changeMenuMode,
        isDesktop,
        hasOpenOverlay,
        presetOptions,
        primaryColors,
        surfaces
    };
}
