const normalizeValue = (value) => (typeof value === 'string' ? value.trim() : '');

export function readSupabaseConfig(env = {}) {
    const source = env && typeof env === 'object' ? env : {};
    const url = normalizeValue(source.VITE_SUPABASE_URL);
    const publishableKey = normalizeValue(source.VITE_SUPABASE_PUBLISHABLE_KEY);

    return {
        configured: Boolean(url && publishableKey),
        url,
        publishableKey
    };
}
