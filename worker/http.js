export const jsonResponse = (body, init = {}) =>
    Response.json(body, {
        ...init,
        headers: { 'cache-control': 'no-store', ...init.headers }
    });
