export const jsonResponse = (body, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('cache-control', 'no-store');

    return Response.json(body, {
        ...init,
        headers
    });
};
