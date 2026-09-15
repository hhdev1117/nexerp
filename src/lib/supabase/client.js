import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './config';

let supabaseClient = null;

export function getSupabaseClient() {
    const config = readSupabaseConfig(import.meta.env);
    if (!config.configured) return null;

    if (!supabaseClient) {
        supabaseClient = createClient(config.url, config.publishableKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    }

    return supabaseClient;
}
