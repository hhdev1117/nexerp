import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSupabaseConfig } from './config';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

beforeEach(() => {
    vi.resetModules();
    createClient.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('Supabase configuration', () => {
    it('reports missing browser values as unconfigured', () => {
        expect(readSupabaseConfig({})).toEqual({ configured: false, url: '', publishableKey: '' });
        expect(readSupabaseConfig()).toEqual({ configured: false, url: '', publishableKey: '' });
        expect(readSupabaseConfig(null)).toEqual({ configured: false, url: '', publishableKey: '' });
    });

    it('trims both browser values before reporting a configured client', () => {
        expect(
            readSupabaseConfig({
                VITE_SUPABASE_URL: ' https://p.supabase.co ',
                VITE_SUPABASE_PUBLISHABLE_KEY: ' key '
            })
        ).toEqual({
            configured: true,
            url: 'https://p.supabase.co',
            publishableKey: 'key'
        });
    });

    it.each([
        [
            { VITE_SUPABASE_URL: 42, VITE_SUPABASE_PUBLISHABLE_KEY: 'key' },
            { configured: false, url: '', publishableKey: 'key' }
        ],
        [
            { VITE_SUPABASE_URL: 'https://p.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: false },
            { configured: false, url: 'https://p.supabase.co', publishableKey: '' }
        ],
        [
            { VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: ' key ' },
            { configured: false, url: '', publishableKey: 'key' }
        ]
    ])('normalizes invalid browser values without throwing', (env, expected) => {
        expect(readSupabaseConfig(env)).toEqual(expected);
    });

    it('does not return unrelated environment fields', () => {
        expect(
            readSupabaseConfig({
                VITE_SUPABASE_URL: 'https://p.supabase.co',
                VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
                UNRELATED_FIELD: 'must-not-leak'
            })
        ).toEqual({ configured: true, url: 'https://p.supabase.co', publishableKey: 'key' });
    });
});

describe('Supabase browser client', () => {
    it('returns null without creating a client when browser configuration is missing', async () => {
        vi.stubEnv('VITE_SUPABASE_URL', '');
        vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
        const { getSupabaseClient } = await import('./client');

        expect(getSupabaseClient()).toBeNull();
        expect(createClient).not.toHaveBeenCalled();
    });

    it('creates one persistent browser client with the normalized configuration', async () => {
        const client = { name: 'supabase-client' };
        createClient.mockReturnValue(client);
        vi.stubEnv('VITE_SUPABASE_URL', ' https://p.supabase.co ');
        vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ' publishable-key ');
        const { getSupabaseClient } = await import('./client');

        expect(getSupabaseClient()).toBe(client);
        expect(getSupabaseClient()).toBe(client);
        expect(createClient).toHaveBeenCalledOnce();
        expect(createClient).toHaveBeenCalledWith('https://p.supabase.co', 'publishable-key', {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    });
});
