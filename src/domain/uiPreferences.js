export const DEFAULT_UI_PREFERENCES = Object.freeze({
    preset: 'Aura',
    primary: 'emerald',
    surface: null,
    darkTheme: false,
    menuMode: 'static'
});

const allowedPresets = new Set(['Aura', 'Lara', 'Nora']);
const allowedPrimaryColors = new Set(['noir', 'emerald', 'green', 'lime', 'orange', 'amber', 'yellow', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']);
const allowedSurfaces = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone', 'soho', 'viva', 'ocean']);
const allowedMenuModes = new Set(['static', 'overlay']);

export function normalizeUiPreferences(value) {
    const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        preset: allowedPresets.has(candidate.preset) ? candidate.preset : DEFAULT_UI_PREFERENCES.preset,
        primary: allowedPrimaryColors.has(candidate.primary) ? candidate.primary : DEFAULT_UI_PREFERENCES.primary,
        surface: candidate.surface === null || allowedSurfaces.has(candidate.surface) ? candidate.surface : DEFAULT_UI_PREFERENCES.surface,
        darkTheme: typeof candidate.darkTheme === 'boolean' ? candidate.darkTheme : DEFAULT_UI_PREFERENCES.darkTheme,
        menuMode: allowedMenuModes.has(candidate.menuMode) ? candidate.menuMode : DEFAULT_UI_PREFERENCES.menuMode
    };
}
