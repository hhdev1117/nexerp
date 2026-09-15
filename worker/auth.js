export function getBearerToken(request) {
    const authorization = request.headers.get('authorization')?.trim();
    const match = authorization?.match(/^Bearer\s+([^\s,]+)$/i);
    return match?.[1] || null;
}
