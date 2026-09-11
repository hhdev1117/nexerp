import { jsonResponse } from './http';

export function createWorkerApp(dependencies = {}) {
    void dependencies;

    return {
        async fetch(request, env) {
            const { pathname } = new URL(request.url);

            if (pathname === '/api/health' && request.method === 'GET') {
                const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);

                return jsonResponse(
                    { ok: configured, services: { supabase: configured ? 'configured' : 'missing_configuration' } },
                    { status: configured ? 200 : 503 }
                );
            }

            if (pathname.startsWith('/api/')) {
                return jsonResponse(
                    { error: { code: 'not_found', message: '요청한 API를 찾을 수 없습니다.' } },
                    { status: 404 }
                );
            }

            return env.ASSETS.fetch(request);
        }
    };
}
