import { createClient } from '@supabase/supabase-js';

class WorkerConfigurationError extends Error {
    constructor() {
        super('Supabase Worker configuration is invalid.');
        this.name = 'WorkerConfigurationError';
        this.code = 'worker_configuration_error';
    }
}

const normalizeValue = (value) => (typeof value === 'string' ? value.trim() : '');

export function createUserSupabaseClient(env, token, createClientDependency = createClient) {
    const url = normalizeValue(env?.SUPABASE_URL);
    const publishableKey = normalizeValue(env?.SUPABASE_PUBLISHABLE_KEY);
    const accessToken = normalizeValue(token);

    if (!url || !publishableKey || !accessToken) throw new WorkerConfigurationError();

    try {
        return createClientDependency(url, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
        });
    } catch {
        throw new WorkerConfigurationError();
    }
}
