import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';

describe('Cloudflare Worker app', () => {
    it('reports configured health without exposing values', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/health'), {
            SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example'
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({ ok: true, services: { supabase: 'configured' } });
    });

    it('reports missing Supabase configuration', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/health'), {
            SUPABASE_URL: 'https://project.supabase.co'
        });

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({ ok: false, services: { supabase: 'missing_configuration' } });
    });

    it('returns the API not-found response for unknown API paths', async () => {
        const app = createWorkerApp();
        const response = await app.fetch(new Request('https://erp.test/api/orders'), {});

        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({
            error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' }
        });
    });

    it('uses the assets binding outside the API namespace', async () => {
        const request = new Request('https://erp.test/sales/orders');
        const fetch = vi.fn().mockResolvedValue(new Response('app'));
        const app = createWorkerApp();
        const response = await app.fetch(request, { ASSETS: { fetch } });

        expect(await response.text()).toBe('app');
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(request);
    });
});
