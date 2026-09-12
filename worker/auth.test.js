import { describe, expect, it, vi } from 'vitest';
import { getBearerToken } from './auth';
import { createUserSupabaseClient } from './supabase';
import * as supabaseClients from './supabase';

describe('getBearerToken', () => {
    it('returns the token without the Bearer scheme', () => {
        const request = new Request('https://erp.test/api/me', {
            headers: { Authorization: '  Bearer session-token  ' }
        });

        expect(getBearerToken(request)).toBe('session-token');
    });

    it.each([[undefined], [''], ['Bearer'], ['Bearer   '], ['Basic credentials'], ['Bearer first Basic second'], ['Bearer first, Bearer second'], ['Bearer token with-spaces']])(
        'rejects a missing or malformed Authorization header %#',
        (authorization) => {
            const headers = authorization === undefined ? {} : { Authorization: authorization };
            expect(getBearerToken(new Request('https://erp.test/api/me', { headers }))).toBeNull();
        }
    );
});

describe('createUserSupabaseClient', () => {
    it('creates a user-scoped client without browser session behavior', () => {
        const client = {};
        const createClient = vi.fn(() => client);

        expect(createUserSupabaseClient({ SUPABASE_URL: ' https://project.supabase.co ', SUPABASE_PUBLISHABLE_KEY: ' publishable-key ' }, 'session-token', createClient)).toBe(client);
        expect(createClient).toHaveBeenCalledWith('https://project.supabase.co', 'publishable-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: 'Bearer session-token' } }
        });
    });

    it.each([
        [{ SUPABASE_PUBLISHABLE_KEY: 'key' }, 'token'],
        [{ SUPABASE_URL: 'https://project.supabase.co' }, 'token'],
        [{ SUPABASE_URL: '   ', SUPABASE_PUBLISHABLE_KEY: 'key' }, 'token'],
        [{ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: '   ' }, 'token'],
        [{ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'key' }, '   ']
    ])('throws a typed configuration error without calling Supabase for invalid inputs %#', (env, token) => {
        const createClient = vi.fn();

        expect(() => createUserSupabaseClient(env, token, createClient)).toThrowError(expect.objectContaining({ name: 'WorkerConfigurationError' }));
        expect(createClient).not.toHaveBeenCalled();
    });

    it('wraps synchronous client construction failures as typed configuration errors', () => {
        const createClient = () => {
            throw new Error('raw URL parser detail');
        };

        expect(() => createUserSupabaseClient({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'key' }, 'token', createClient)).toThrowError(
            expect.objectContaining({ name: 'WorkerConfigurationError', message: 'Supabase Worker configuration is invalid.' })
        );
    });
});

describe('createAdminSupabaseClient', () => {
    it('creates a server-only client with the secret key and no browser session behavior', () => {
        const client = {};
        const createClient = vi.fn(() => client);

        expect(typeof supabaseClients.createAdminSupabaseClient).toBe('function');
        expect(
            supabaseClients.createAdminSupabaseClient(
                {
                    SUPABASE_URL: ' https://project.supabase.co ',
                    SUPABASE_PUBLISHABLE_KEY: 'must-not-be-used',
                    SUPABASE_SECRET_KEY: ' sb_secret_server_only '
                },
                createClient
            )
        ).toBe(client);
        expect(createClient).toHaveBeenCalledWith('https://project.supabase.co', 'sb_secret_server_only', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
    });

    it.each([
        [{}],
        [{ SUPABASE_URL: 'https://project.supabase.co' }],
        [{ SUPABASE_SECRET_KEY: 'sb_secret_server_only' }],
        [{ SUPABASE_URL: '   ', SUPABASE_SECRET_KEY: 'sb_secret_server_only' }],
        [{ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: '   ' }]
    ])('rejects missing server configuration without constructing a client %#', (env) => {
        const createClient = vi.fn();

        expect(typeof supabaseClients.createAdminSupabaseClient).toBe('function');
        expect(() => supabaseClients.createAdminSupabaseClient(env, createClient)).toThrowError(expect.objectContaining({ code: 'worker_configuration_error' }));
        expect(createClient).not.toHaveBeenCalled();
    });
});
