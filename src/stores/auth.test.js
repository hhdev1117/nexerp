import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createAuthStore } from './auth';

const profileFields = 'id, email, display_name, department, role, is_active';
const approverProfile = {
    id: 'user-1',
    email: 'approver@nexerp.test',
    display_name: 'Kim Approver',
    department: 'Finance',
    role: 'approver',
    is_active: true
};

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

const jwtSession = (sessionId, issuedAt = 1789257600, userId = 'user-1') => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://auth.nexerp.test/auth/v1', aud: 'authenticated', sub: userId, role: 'authenticated', session_id: sessionId, iat: issuedAt, exp: issuedAt + 3600 })).toString('base64url');
    const signature = createHmac('sha256', 'test-fixture-signing-key').update(`${header}.${payload}`).digest('base64url');
    return { access_token: `${header}.${payload}.${signature}`, user: { id: userId, email: `${userId}@nexerp.test` } };
};

const mfaFactor = (id, status = 'verified') => ({ id, factor_type: 'totp', status, friendly_name: 'NEXERP Authenticator' });
const mfaFactorResult = (factors) => ({ data: { all: factors, totp: factors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified') }, error: null });

const createClient = ({
    session = null,
    profiles = {},
    signInResult,
    signOutError = null,
    updateUserResult,
    getUserResult,
    mfaFactors = [],
    mfaAal = { currentLevel: 'aal1', nextLevel: 'aal1' },
    mfaEnrollResult,
    mfaVerifyResult,
    refreshSessionResult
} = {}) => {
    let authListener;
    const unsubscribe = vi.fn();
    const profileRequests = [];
    const client = {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
            getUser: vi.fn().mockResolvedValue(
                getUserResult || {
                    data: { user: session?.user || null },
                    error: null
                }
            ),
            onAuthStateChange: vi.fn((listener) => {
                authListener = listener;
                return { data: { subscription: { unsubscribe } } };
            }),
            signInWithPassword: vi.fn().mockResolvedValue(
                signInResult || {
                    data: { session, user: session?.user || null },
                    error: null
                }
            ),
            updateUser: vi.fn().mockResolvedValue(updateUserResult || { data: { user: session?.user || null }, error: null }),
            signOut: vi.fn().mockResolvedValue({ error: signOutError }),
            refreshSession: vi.fn().mockResolvedValue(refreshSessionResult || { data: { session }, error: null }),
            mfa: {
                listFactors: vi.fn().mockResolvedValue({ data: { all: mfaFactors, totp: mfaFactors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified') }, error: null }),
                getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: mfaAal, error: null }),
                enroll: vi.fn().mockResolvedValue(
                    mfaEnrollResult || {
                        data: {
                            id: 'totp-factor-1',
                            type: 'totp',
                            totp: { qr_code: '<svg/>', secret: 'TEST-SECRET', uri: 'otpauth://totp/NEXERP:test?secret=TEST-SECRET' }
                        },
                        error: null
                    }
                ),
                challenge: vi.fn().mockResolvedValue({ data: { id: 'challenge-1', type: 'totp', expires_at: 1789257660 }, error: null }),
                verify: vi.fn().mockResolvedValue(
                    mfaVerifyResult || {
                        data: {
                            access_token: session?.access_token || 'mfa-access-token',
                            user: session?.user || { id: 'user-1', email: 'approver@nexerp.test' }
                        },
                        error: null
                    }
                ),
                unenroll: vi.fn().mockResolvedValue({ data: { id: 'totp-factor-1' }, error: null })
            }
        },
        from: vi.fn((table) => {
            expect(table).toBe('profiles');
            const request = { fields: null, id: null };
            profileRequests.push(request);
            return {
                select(fields) {
                    request.fields = fields;
                    return this;
                },
                eq(column, id) {
                    expect(column).toBe('id');
                    request.id = id;
                    return this;
                },
                maybeSingle() {
                    const result = profiles[request.id];
                    return result instanceof Promise ? result : Promise.resolve(result || { data: null, error: null });
                }
            };
        })
    };

    return {
        client,
        emit(event, nextSession) {
            return authListener(event, nextSession);
        },
        profileRequests,
        unsubscribe
    };
};

describe('Supabase auth store', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('initializes once with the current approver and selects only public profile fields', async () => {
        const session = { access_token: 'not-logged', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });

        const first = store.initialize();
        const second = store.initialize();
        await Promise.all([first, second]);
        await store.initialize();

        expect(fixture.client.auth.getSession).toHaveBeenCalledTimes(1);
        expect(fixture.client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
        expect(fixture.profileRequests).toEqual([{ fields: profileFields, id: 'user-1' }]);
        expect(store.session.value).toEqual(session);
        expect(store.user.value).toEqual(session.user);
        expect(store.profile.value).toEqual(approverProfile);
        expect(store.role.value).toBe('approver');
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
        expect(store.configured.value).toBe(true);
    });

    it('initializes safely without configuration and rejects sign-in with a stable message', async () => {
        const store = createAuthStore({ client: null, configured: false });

        await expect(store.initialize()).resolves.toBeUndefined();
        await expect(store.signIn('user@nexerp.test', 'password')).rejects.toThrow('Supabase 연결 정보가 설정되지 않았습니다.');

        expect(store.initialized.value).toBe(true);
        expect(store.configured.value).toBe(false);
        expect(store.error.value).toBe('Supabase 연결 정보가 설정되지 않았습니다.');
    });

    it('blocks a locally cached session that Supabase reports as revoked without signing out', async () => {
        const session = { access_token: 'revoked-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            getUserResult: { data: { user: null }, error: revoked }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();

        expect(fixture.client.auth.getUser).toHaveBeenCalledWith(session.access_token);
        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(fixture.profileRequests).toHaveLength(0);
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(store.error.value).toBe('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
    });

    it('validates a duplicate SIGNED_IN event emitted while the stored session is loading', async () => {
        const sessionLookup = deferred();
        const session = { access_token: 'revoked-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            getUserResult: { data: { user: null }, error: revoked }
        });
        fixture.client.auth.getSession.mockReturnValueOnce(sessionLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await fixture.emit('SIGNED_IN', session);
        sessionLookup.resolve({ data: { session }, error: null });
        await initialization;

        expect(fixture.client.auth.getUser).toHaveBeenCalledWith(session.access_token);
        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(store.error.value).toBe('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
        expect(store.initialized.value).toBe(true);
    });

    it('ignores duplicate rejected-token events after stored-session verification', async () => {
        const userLookup = deferred();
        const session = { access_token: 'revoked-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } }
        });
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledWith(session.access_token));
        await fixture.emit('SIGNED_IN', session);
        userLookup.resolve({ data: { user: null }, error: revoked });
        await initialization;

        await fixture.emit('SIGNED_IN', session);
        await fixture.emit('TOKEN_REFRESHED', session);

        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(store.error.value).toBe('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
    });

    it.each(['session lookup', 'user verification'])('rejects a refreshed JWT from the revoked session buffered during %s', async (phase) => {
        const sessionLookup = deferred();
        const userLookup = deferred();
        const sessionA = jwtSession('00000000-0000-4000-8000-00000000000a');
        const sessionA2 = jwtSession('00000000-0000-4000-8000-00000000000a', 1789257900);
        const fixture = createClient({ session: sessionA, profiles: { 'user-1': { data: approverProfile, error: null } } });
        fixture.client.auth.getSession.mockReturnValueOnce(sessionLookup.promise);
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        expect(sessionA.access_token === sessionA2.access_token).toBe(false);
        const initialization = store.initialize();
        if (phase === 'session lookup') await fixture.emit('TOKEN_REFRESHED', sessionA2);
        sessionLookup.resolve({ data: { session: sessionA }, error: null });
        if (phase === 'user verification') {
            await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledOnce());
            await fixture.emit('TOKEN_REFRESHED', sessionA2);
        }
        userLookup.resolve({ data: { user: null }, error: { code: 'session_not_found', status: 400 } });
        await initialization;

        expect(store.role.value).toBeNull();
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(fixture.profileRequests).toHaveLength(0);
        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
    });

    it('ignores refreshed JWT events from a rejected session after initialization and after a new login', async () => {
        const sessionA = jwtSession('00000000-0000-4000-8000-00000000000a');
        const sessionA2 = jwtSession('00000000-0000-4000-8000-00000000000a', 1789257900);
        const sessionB = jwtSession('00000000-0000-4000-8000-00000000000b');
        const fixture = createClient({
            session: sessionA,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            getUserResult: { data: { user: null }, error: { code: 'session_not_found', status: 400 } },
            signInResult: { data: { session: sessionB, user: sessionB.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();
        await fixture.emit('TOKEN_REFRESHED', sessionA2);
        await fixture.emit('SIGNED_IN', sessionA2);
        expect(store.role.value).toBeNull();
        expect(store.session.value).toBeNull();
        expect(fixture.profileRequests).toHaveLength(0);

        await store.signIn(sessionB.user.email, 'password');
        await fixture.emit('TOKEN_REFRESHED', sessionA2);
        expect(store.role.value).toBe('approver');
        expect(store.session.value).toEqual(sessionB);
        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
    });

    it.each([null, undefined, 123, '', '   '])('never initializes an identity with an unusable access token (case %#)', async (accessToken) => {
        const malformedSession = { access_token: accessToken, user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const sessionLookup = deferred();
        const fixture = createClient({ session: malformedSession, profiles: { 'user-1': { data: approverProfile, error: null } } });
        fixture.client.auth.getSession.mockReturnValueOnce(sessionLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await fixture.emit('SIGNED_IN', malformedSession);
        sessionLookup.resolve({ data: { session: malformedSession }, error: null });
        await initialization;

        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(fixture.profileRequests).toHaveLength(0);
        expect(fixture.client.auth.getUser).not.toHaveBeenCalled();
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
    });

    it.each([null, undefined, 123, '', '   '])('ignores unusable-token events without replacing a valid identity (case %#)', async (accessToken) => {
        const malformedSession = { access_token: accessToken, user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const sessionB = jwtSession('session-b', 1789257600, 'user-2');
        const profileB = { ...approverProfile, id: 'user-2', role: 'admin' };
        const fixture = createClient({
            profiles: { 'user-1': { data: approverProfile, error: null }, 'user-2': { data: profileB, error: null } }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
            await fixture.emit(event, malformedSession);
            expect(store.session.value).toBeNull();
            expect(store.user.value).toBeNull();
            expect(store.profile.value).toBeNull();
            expect(store.role.value).toBeNull();
        }
        expect(fixture.profileRequests).toHaveLength(0);

        await fixture.emit('SIGNED_IN', sessionB);
        for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
            await fixture.emit(event, malformedSession);
            expect(store.session.value).toEqual(sessionB);
            expect(store.user.value).toEqual(sessionB.user);
            expect(store.profile.value).toEqual(profileB);
            expect(store.role.value).toBe('admin');
        }
        expect(fixture.profileRequests).toHaveLength(1);
    });

    it.each([null, undefined, 123, '', '   '])('rejects sign-in success responses with unusable access tokens (case %#)', async (accessToken) => {
        const malformedSession = { access_token: accessToken, user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: malformedSession, user: malformedSession.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await expect(store.signIn(malformedSession.user.email, 'password')).rejects.toThrow('로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(fixture.profileRequests).toHaveLength(0);
        expect(store.loading.value).toBe(false);
    });

    it.each(['session lookup', 'user verification', 'after initialization'])('blocks a rotated opaque-token family during %s until explicit sign-in', async (phase) => {
        const sessionA = { access_token: 'opaque-a', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const sessionA2 = { ...sessionA, access_token: 'header.%.signature' };
        const sessionB = jwtSession('session-b');
        const sessionC = jwtSession('session-c');
        const sessionLookup = deferred();
        const userLookup = deferred();
        const fixture = createClient({
            session: sessionA,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: sessionA2, user: sessionA2.user }, error: null }
        });
        fixture.client.auth.getSession.mockReturnValueOnce(sessionLookup.promise);
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        if (phase === 'session lookup') await fixture.emit('TOKEN_REFRESHED', sessionA2);
        sessionLookup.resolve({ data: { session: sessionA }, error: null });
        if (phase === 'user verification') {
            await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledOnce());
            await fixture.emit('TOKEN_REFRESHED', sessionA2);
        }
        userLookup.resolve({ data: { user: null }, error: { code: 'bad_jwt' } });
        await initialization;
        await fixture.emit('SIGNED_IN', sessionA2);
        await fixture.emit('TOKEN_REFRESHED', sessionA2);

        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(fixture.profileRequests).toHaveLength(0);

        for (const currentSession of [sessionB, sessionC]) {
            await fixture.emit('SIGNED_IN', currentSession);
            await fixture.emit('TOKEN_REFRESHED', sessionA2);
            expect(store.session.value).toEqual(currentSession);
            expect(store.role.value).toBe('approver');
        }
        await store.signIn(sessionA2.user.email, 'password');
        await fixture.emit('TOKEN_REFRESHED', sessionA);
        expect(store.session.value).toEqual(sessionA);
        expect(store.role.value).toBe('approver');
    });

    it('keeps an explicit opaque-token login usable after stale verification rejects the same user', async () => {
        const sessionA = { access_token: 'opaque-a', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const sessionB = { ...sessionA, access_token: 'opaque-b' };
        const sessionB2 = { ...sessionA, access_token: 'opaque-b-refreshed' };
        const userLookup = deferred();
        const fixture = createClient({
            session: sessionA,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: sessionB, user: sessionB.user }, error: null }
        });
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledOnce());
        await store.signIn(sessionB.user.email, 'password');
        userLookup.resolve({ data: { user: null }, error: { code: 'bad_jwt' } });
        await initialization;
        await fixture.emit('TOKEN_REFRESHED', sessionB2);

        expect(store.session.value).toEqual(sessionB2);
        expect(store.user.value).toEqual(sessionB2.user);
        expect(store.profile.value).toEqual(approverProfile);
        expect(store.role.value).toBe('approver');
        expect(store.error.value).toBeNull();
    });

    it('does not let a late rejected-token event overwrite a newer identity', async () => {
        const revokedSession = { access_token: 'revoked-access-token', user: { id: 'user-1', email: 'old@nexerp.test' } };
        const newerSession = { access_token: 'new-access-token', user: { id: 'user-2', email: 'new@nexerp.test' } };
        const newerProfile = { ...approverProfile, id: 'user-2', email: 'new@nexerp.test', role: 'admin' };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session: revokedSession,
            profiles: { 'user-2': { data: newerProfile, error: null } },
            getUserResult: { data: { user: null }, error: revoked }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();
        await fixture.emit('SIGNED_IN', newerSession);
        await fixture.emit('TOKEN_REFRESHED', revokedSession);

        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.session.value).toEqual(newerSession);
        expect(store.user.value).toEqual(newerSession.user);
        expect(store.profile.value).toEqual(newerProfile);
        expect(store.role.value).toBe('admin');
        expect(store.error.value).toBeNull();
    });

    it('keeps the newest non-rejected session when auth events cross stored-session verification', async () => {
        const userLookup = deferred();
        const revokedSession = jwtSession('00000000-0000-4000-8000-00000000000a');
        const refreshedRevokedSession = jwtSession('00000000-0000-4000-8000-00000000000a', 1789257900);
        const sessionB = jwtSession('00000000-0000-4000-8000-00000000000b', 1789257600, 'user-2');
        const sessionC = jwtSession('00000000-0000-4000-8000-00000000000c', 1789257600, 'user-3');
        const profileC = { ...approverProfile, id: 'user-3', email: 'c@nexerp.test', role: 'admin' };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session: revokedSession,
            profiles: { 'user-3': { data: profileC, error: null } }
        });
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledWith(revokedSession.access_token));
        await fixture.emit('SIGNED_IN', sessionB);
        await fixture.emit('TOKEN_REFRESHED', sessionC);
        userLookup.resolve({ data: { user: null }, error: revoked });
        await initialization;
        await fixture.emit('SIGNED_IN', revokedSession);
        await fixture.emit('TOKEN_REFRESHED', refreshedRevokedSession);

        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.session.value).toEqual(sessionC);
        expect(store.user.value).toEqual(sessionC.user);
        expect(store.profile.value).toEqual(profileC);
        expect(store.role.value).toBe('admin');
        expect(store.initialized.value).toBe(true);
        expect(store.loading.value).toBe(false);
    });

    it.each(['not-a-jwt', 'header.%.signature', 'header.bm90LWpzb24.signature', 'header.bnVsbA.signature', jwtSession(null).access_token, jwtSession({}).access_token, jwtSession('').access_token, jwtSession(undefined).access_token])(
        'rejects an unidentifiable session safely without exposing credentials (case %#)',
        async (accessToken) => {
            const session = { access_token: accessToken, user: { id: 'user-1', email: 'approver@nexerp.test' } };
            const fixture = createClient({
                session,
                profiles: { 'user-1': { data: approverProfile, error: null } },
                getUserResult: { data: { user: null }, error: { code: 'bad_jwt', message: accessToken } }
            });
            const store = createAuthStore({ client: fixture.client, configured: true });

            await expect(store.initialize()).resolves.toBeUndefined();
            await fixture.emit('TOKEN_REFRESHED', session);

            expect(store.role.value).toBeNull();
            expect(store.session.value).toBeNull();
            expect(store.error.value).toBe('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
            expect(fixture.profileRequests).toHaveLength(0);
            expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        }
    );

    it('keeps an explicit new login when the old JWT verification finishes and its token refresh arrives', async () => {
        const userLookup = deferred();
        const sessionA = jwtSession('00000000-0000-4000-8000-00000000000a');
        const sessionA2 = jwtSession('00000000-0000-4000-8000-00000000000a', 1789257900);
        const sessionB = jwtSession('00000000-0000-4000-8000-00000000000b');
        const fixture = createClient({
            session: sessionA,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: sessionB, user: sessionB.user }, error: null }
        });
        fixture.client.auth.getUser.mockReturnValueOnce(userLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await vi.waitFor(() => expect(fixture.client.auth.getUser).toHaveBeenCalledOnce());
        await store.signIn(sessionB.user.email, 'password');
        userLookup.resolve({ data: { user: null }, error: { code: 'session_not_found', status: 400 } });
        await initialization;
        await fixture.emit('TOKEN_REFRESHED', sessionA2);

        expect(store.session.value?.access_token === sessionB.access_token).toBe(true);
        expect(store.role.value).toBe('approver');
        expect(store.error.value).toBeNull();
        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
    });

    it('allows an explicitly signed-in token that was rejected during initialization', async () => {
        const revokedSession = { access_token: 'revoked-access-token', user: { id: 'user-1', email: 'old@nexerp.test' } };
        const revoked = Object.assign(new Error('session_not_found private detail'), {
            name: 'AuthSessionMissingError',
            status: 400
        });
        const fixture = createClient({
            session: revokedSession,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            getUserResult: { data: { user: null }, error: revoked },
            signInResult: { data: { session: revokedSession, user: revokedSession.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();
        await store.signIn('old@nexerp.test', 'password');
        await fixture.emit('SIGNED_OUT', null);
        await fixture.emit('SIGNED_IN', revokedSession);

        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(store.session.value).toEqual(revokedSession);
        expect(store.user.value).toEqual(revokedSession.user);
        expect(store.profile.value).toEqual(approverProfile);
        expect(store.role.value).toBe('approver');
    });

    it('does not revoke local credentials when stored-session verification fails transiently', async () => {
        const session = { access_token: 'current-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const temporaryFailure = Object.assign(new Error('Failed to fetch private auth endpoint'), {
            name: 'AuthRetryableFetchError',
            status: 503
        });
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            getUserResult: { data: { user: null }, error: temporaryFailure }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();

        expect(fixture.client.auth.signOut).not.toHaveBeenCalled();
        expect(fixture.profileRequests).toHaveLength(0);
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.error.value).toBe('네트워크 연결을 확인한 후 다시 시도해 주세요.');
    });

    it('normalizes invalid credentials without exposing the raw auth error', async () => {
        const raw = new Error('Invalid login credentials access_token=secret');
        raw.status = 400;
        const fixture = createClient({ signInResult: { data: { session: null, user: null }, error: raw } });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await expect(store.signIn('user@nexerp.test', 'wrong')).rejects.toThrow('이메일 또는 비밀번호가 올바르지 않습니다.');
        expect(store.error.value).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
        expect(store.error.value).not.toContain('secret');
    });

    it('normalizes thrown network failures without exposing dependency details', async () => {
        const fixture = createClient();
        fixture.client.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch https://private.example?access_token=secret'));
        const store = createAuthStore({ client: fixture.client, configured: true });

        await expect(store.signIn('user@nexerp.test', 'password')).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        expect(store.error.value).toBe('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('secret');
    });

    it('initializes with a stable network error when session lookup throws', async () => {
        const fixture = createClient();
        fixture.client.auth.getSession.mockRejectedValueOnce(new TypeError('Failed to fetch private session endpoint'));
        const store = createAuthStore({ client: fixture.client, configured: true });

        await expect(store.initialize()).resolves.toBeUndefined();

        expect(store.initialized.value).toBe(true);
        expect(store.error.value).toBe('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        expect(fixture.client.auth.onAuthStateChange).toHaveBeenCalledOnce();
    });

    it('signs in with email and password and loads the authenticated profile', async () => {
        const session = { access_token: 'not-logged', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session, user: session.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        const result = await store.signIn('approver@nexerp.test', 'password');

        expect(fixture.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'approver@nexerp.test', password: 'password' });
        expect(result).toEqual({ session, user: session.user });
        expect(store.profile.value).toEqual(approverProfile);
        expect(store.role.value).toBe('approver');
    });

    it('reauthenticates the current active user before changing the password', async () => {
        const session = { access_token: 'not-logged', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session, user: session.user }, error: null },
            updateUserResult: { data: { user: session.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.changePassword('Current-Password-1!', 'Replacement-Password-2!')).resolves.toBeUndefined();

        expect(fixture.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'approver@nexerp.test', password: 'Current-Password-1!' });
        expect(fixture.client.auth.updateUser).toHaveBeenCalledWith({ password: 'Replacement-Password-2!' });
        expect(fixture.client.auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(fixture.client.auth.updateUser.mock.invocationCallOrder[0]);
        expect(store.error.value).toBeNull();
        expect(store.loading.value).toBe(false);
    });

    it.each([
        ['', 'Replacement-Password-2!', '현재 비밀번호를 입력해 주세요.'],
        ['Current-Password-1!', '', '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.'],
        ['Current-Password-1!', '       ', '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.'],
        ['Current-Password-1!', 'short7', '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.'],
        ['Current-Password-1!', 'x'.repeat(129), '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.'],
        ['Same-Password-1!', 'Same-Password-1!', '새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.']
    ])('rejects invalid password input without calling Supabase', async (currentPassword, newPassword, message) => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.changePassword(currentPassword, newPassword)).rejects.toThrow(message);

        expect(fixture.client.auth.signInWithPassword).not.toHaveBeenCalled();
        expect(fixture.client.auth.updateUser).not.toHaveBeenCalled();
    });

    it('requires a configured active identity with a session and email', async () => {
        const unconfigured = createAuthStore({ client: null, configured: false });
        await expect(unconfigured.changePassword('Current-Password-1!', 'Replacement-Password-2!')).rejects.toThrow('Supabase 연결 정보가 설정되지 않았습니다.');

        const fixture = createClient({ session: null });
        const signedOut = createAuthStore({ client: fixture.client, configured: true });
        await expect(signedOut.changePassword('Current-Password-1!', 'Replacement-Password-2!')).rejects.toThrow('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');

        const inactiveSession = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const inactiveFixture = createClient({
            session: inactiveSession,
            profiles: { 'user-1': { data: { ...approverProfile, is_active: false }, error: null } }
        });
        const inactive = createAuthStore({ client: inactiveFixture.client, configured: true });
        await inactive.initialize();
        await expect(inactive.changePassword('Current-Password-1!', 'Replacement-Password-2!')).rejects.toThrow('비활성화된 계정입니다. 관리자에게 문의해 주세요.');
    });

    it('redacts invalid current-password details and does not update the user', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const raw = new Error('Invalid login credentials password=sentinel-secret');
        raw.status = 400;
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: null, user: null }, error: raw }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.changePassword('sentinel-current-password', 'Replacement-Password-2!')).rejects.toThrow('현재 비밀번호가 올바르지 않습니다.');

        expect(store.error.value).toBe('현재 비밀번호가 올바르지 않습니다.');
        expect(store.error.value).not.toContain('sentinel');
        expect(fixture.client.auth.updateUser).not.toHaveBeenCalled();
    });

    it('rejects a reauthenticated identity mismatch before updating the password', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session: { user: { id: 'user-2' } }, user: { id: 'user-2', email: 'other@nexerp.test' } }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.changePassword('Current-Password-1!', 'Replacement-Password-2!')).rejects.toThrow('로그인 상태가 변경되었습니다. 다시 로그인해 주세요.');

        expect(fixture.client.auth.updateUser).not.toHaveBeenCalled();
    });

    it('redacts password-update failures behind a stable message', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            signInResult: { data: { session, user: session.user }, error: null },
            updateUserResult: { data: { user: null }, error: new Error('provider rejected password=sentinel-secret') }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.changePassword('Current-Password-1!', 'Replacement-Password-2!')).rejects.toThrow('비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.');

        expect(store.error.value).toBe('비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('sentinel');
    });

    it('keeps local identity when sign-out fails and clears it only after success', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } }, signOutError: new Error('network failed') });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.signOut()).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        expect(store.user.value).toEqual(session.user);

        fixture.client.auth.signOut.mockResolvedValueOnce({ error: null });
        await store.signOut();
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
    });

    it('normalizes a thrown sign-out failure and preserves local identity', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        fixture.client.auth.signOut.mockRejectedValueOnce(new TypeError('network failed with private detail'));

        await expect(store.signOut()).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');

        expect(store.user.value).toEqual(session.user);
        expect(store.profile.value).toEqual(approverProfile);
    });

    it('does not clear local identity from an early sign-out event before the request succeeds', async () => {
        const signOutRequest = deferred();
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        fixture.client.auth.signOut.mockReturnValueOnce(signOutRequest.promise);

        const signingOut = store.signOut();
        await fixture.emit('SIGNED_OUT', null);
        expect(store.user.value).toEqual(session.user);
        expect(store.profile.value).toEqual(approverProfile);

        signOutRequest.resolve({ error: null });
        await signingOut;
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
    });

    it('grants listed roles only to active profiles and clears state on sign-out events', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        expect(store.hasRole(['admin', 'approver'])).toBe(true);
        expect(store.hasRole(['admin'])).toBe(false);
        expect(store.hasRole('approver')).toBe(false);

        await fixture.emit('SIGNED_OUT', null);
        expect(store.session.value).toBeNull();
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(store.error.value).toBeNull();
    });

    it('denies inactive profiles with a stable authorization error', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'disabled@nexerp.test' } };
        const inactive = { ...approverProfile, email: 'disabled@nexerp.test', is_active: false };
        const fixture = createClient({ session, profiles: { 'user-1': { data: inactive, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();

        expect(store.profile.value).toEqual(inactive);
        expect(store.role.value).toBeNull();
        expect(store.hasRole(['approver'])).toBe(false);
        expect(store.error.value).toBe('비활성화된 계정입니다. 관리자에게 문의해 주세요.');
    });

    it('does not grant a role when the matching profile is missing', async () => {
        const session = { access_token: 'missing-user-access-token', user: { id: 'missing-user', email: 'missing@nexerp.test' } };
        const fixture = createClient({ session });
        const store = createAuthStore({ client: fixture.client, configured: true });

        await store.initialize();

        expect(store.profile.value).toBeNull();
        expect(store.role.value).toBeNull();
        expect(store.hasRole(['user'])).toBe(false);
        expect(store.error.value).toBe('계정 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
    });

    it('lets a newer auth event win while initial profile loading is pending', async () => {
        const oldProfile = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const fixture = createClient({
            session: oldSession,
            profiles: {
                'old-user': oldProfile.promise,
                'new-user': { data: newProfile, error: null }
            }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await Promise.resolve();
        await fixture.emit('SIGNED_IN', newSession);
        oldProfile.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await initialization;

        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
        expect(store.role.value).toBe('admin');
    });

    it('does not let a stale getSession result overwrite an auth event', async () => {
        const sessionLookup = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const fixture = createClient({
            profiles: {
                'old-user': { data: { ...approverProfile, id: 'old-user' }, error: null },
                'new-user': { data: newProfile, error: null }
            }
        });
        fixture.client.auth.getSession.mockReturnValueOnce(sessionLookup.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });

        const initialization = store.initialize();
        await fixture.emit('SIGNED_IN', newSession);
        sessionLookup.resolve({ data: { session: oldSession }, error: null });
        await initialization;

        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
        expect(store.role.value).toBe('admin');
    });

    it('waits for a newer auth profile when the initial profile resolves first', async () => {
        const oldProfile = deferred();
        const newProfileRequest = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const fixture = createClient({
            session: oldSession,
            profiles: {
                'old-user': oldProfile.promise,
                'new-user': newProfileRequest.promise
            }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        let initialized = false;

        const initialization = store.initialize().then(() => {
            initialized = true;
        });
        await Promise.resolve();
        const authUpdate = fixture.emit('SIGNED_IN', newSession);
        oldProfile.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(initialized).toBe(false);
        newProfileRequest.resolve({ data: newProfile, error: null });
        await authUpdate;
        await initialization;
        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
    });

    it('waits for a newer auth profile before successful sign-in resolves', async () => {
        const oldProfile = deferred();
        const newProfileRequest = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'user' };
        const fixture = createClient({
            profiles: {
                'old-user': oldProfile.promise,
                'new-user': newProfileRequest.promise
            },
            signInResult: { data: { session: oldSession, user: oldSession.user }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        let signedIn = false;

        const signingIn = store.signIn('old@nexerp.test', 'password').then(() => {
            signedIn = true;
        });
        await Promise.resolve();
        const authUpdate = fixture.emit('SIGNED_IN', newSession);
        oldProfile.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(signedIn).toBe(false);
        newProfileRequest.resolve({ data: newProfile, error: null });
        await authUpdate;
        await signingIn;
        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
    });

    it('waits for the latest identity update when the observed update is superseded', async () => {
        const oldProfileRequest = deferred();
        const newProfileRequest = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const fixture = createClient({
            profiles: {
                'old-user': oldProfileRequest.promise,
                'new-user': newProfileRequest.promise
            }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        let settled = false;

        const oldUpdate = fixture.emit('TOKEN_REFRESHED', oldSession);
        const waiting = store.waitForIdentity().then(() => {
            settled = true;
        });
        const newUpdate = fixture.emit('SIGNED_IN', newSession);
        oldProfileRequest.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(settled).toBe(false);
        expect(store.loading.value).toBe(true);

        newProfileRequest.resolve({ data: newProfile, error: null });
        await Promise.all([oldUpdate, newUpdate, waiting]);

        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
        expect(store.loading.value).toBe(false);
    });

    it('retries the current profile after a temporary failure and normalizes the error', async () => {
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const profiles = {
            'user-1': { data: null, error: new TypeError('Failed to fetch https://private.example?access_token=secret') }
        };
        const fixture = createClient({ session, profiles });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        expect(store.profile.value).toBeNull();
        expect(store.profileLoadFailed.value).toBe(true);
        expect(store.error.value).toBe('네트워크 연결을 확인한 후 다시 시도해 주세요.');

        const profileRequest = deferred();
        profiles['user-1'] = profileRequest.promise;
        const retrying = store.retryProfile();

        expect(store.loading.value).toBe(true);
        expect(store.profileLoadFailed.value).toBe(true);
        profileRequest.resolve({ data: approverProfile, error: null });
        await retrying;

        expect(fixture.profileRequests).toHaveLength(2);
        expect(store.profile.value).toEqual(approverProfile);
        expect(store.profileLoadFailed.value).toBe(false);
        expect(store.error.value).toBeNull();
        expect(store.loading.value).toBe(false);
    });

    it('does not let a stale profile retry overwrite a newer signed-in identity', async () => {
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const oldProfileRetry = deferred();
        const oldProfiles = { data: null, error: new Error('temporary profile failure') };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const profiles = {
            'old-user': oldProfiles,
            'new-user': { data: newProfile, error: null }
        };
        const fixture = createClient({ session: oldSession, profiles });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        profiles['old-user'] = oldProfileRetry.promise;

        const retrying = store.retryProfile();
        const newerUpdate = fixture.emit('SIGNED_IN', newSession);
        oldProfileRetry.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await Promise.all([retrying, newerUpdate]);

        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
        expect(store.role.value).toBe('admin');
    });

    it('reconciles a buffered signed-out event after explicit sign-out fails', async () => {
        const signOutRequest = deferred();
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        fixture.client.auth.signOut.mockReturnValueOnce(signOutRequest.promise);
        fixture.client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

        const signingOut = store.signOut();
        await fixture.emit('SIGNED_OUT', null);
        signOutRequest.resolve({ error: new Error('network failed') });
        await expect(signingOut).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');

        expect(fixture.client.auth.getSession).toHaveBeenCalledTimes(2);
        expect(store.user.value).toBeNull();
        expect(store.profile.value).toBeNull();
    });

    it('keeps the sign-out event guard active until overlapping operations settle', async () => {
        const firstRequest = deferred();
        const secondRequest = deferred();
        const session = { access_token: 'user-1-access-token', user: { id: 'user-1', email: 'approver@nexerp.test' } };
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        fixture.client.auth.signOut.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
        fixture.client.auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });

        const firstSignOut = store.signOut();
        const secondSignOut = store.signOut();
        firstRequest.resolve({ error: new Error('network failed') });
        await expect(firstSignOut).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        await fixture.emit('SIGNED_OUT', null);

        expect(store.user.value).toEqual(session.user);
        secondRequest.resolve({ error: new Error('network failed') });
        await expect(secondSignOut).rejects.toThrow('네트워크 연결을 확인한 후 다시 시도해 주세요.');
        expect(fixture.client.auth.getSession).toHaveBeenCalledTimes(2);
        expect(store.user.value).toEqual(session.user);
        expect(store.profile.value).toEqual(approverProfile);
    });

    it('ignores a stale profile response after a newer auth session arrives', async () => {
        const oldProfile = deferred();
        const oldSession = { access_token: 'old-user-access-token', user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { access_token: 'new-user-access-token', user: { id: 'new-user', email: 'new@nexerp.test' } };
        const newProfile = { ...approverProfile, id: 'new-user', email: 'new@nexerp.test', role: 'admin' };
        const fixture = createClient({
            session: null,
            profiles: {
                'old-user': oldProfile.promise,
                'new-user': { data: newProfile, error: null }
            }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        const oldUpdate = fixture.emit('SIGNED_IN', oldSession);
        const newUpdate = fixture.emit('SIGNED_IN', newSession);
        await newUpdate;
        oldProfile.resolve({ data: { ...approverProfile, id: 'old-user' }, error: null });
        await oldUpdate;

        expect(store.session.value).toEqual(newSession);
        expect(store.user.value).toEqual(newSession.user);
        expect(store.profile.value).toEqual(newProfile);
        expect(store.role.value).toBe('admin');
    });

    it.each([
        ['enroll', [], { currentLevel: 'aal1', nextLevel: 'aal1' }],
        ['enroll', [], { currentLevel: 'aal2', nextLevel: 'aal2' }],
        ['challenge', [mfaFactor('totp-factor-1')], { currentLevel: 'aal1', nextLevel: 'aal2' }],
        ['ready', [mfaFactor('totp-factor-1')], { currentLevel: 'aal2', nextLevel: 'aal2' }]
    ])('maps the verified factor and assurance state to %s', async (expectedStatus, factors, aal) => {
        const session = jwtSession('mfa-state');
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } }, mfaFactors: factors, mfaAal: aal });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await store.refreshMfaState();

        expect(store.mfaStatus.value).toBe(expectedStatus);
        expect(store.mfaFactors.value).toEqual(factors.filter((factor) => factor.status === 'verified'));
        expect(store.mfaSatisfied.value).toBe(expectedStatus === 'ready');
    });

    it('fails closed with a stable message when the MFA lookup fails', async () => {
        const session = jwtSession('mfa-lookup-failure');
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        fixture.client.auth.mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error('provider raw secret detail') });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await expect(store.refreshMfaState()).rejects.toThrow('다중 인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');

        expect(store.mfaStatus.value).toBe('error');
        expect(store.mfaSatisfied.value).toBe(false);
        expect(store.error.value).toBe('다중 인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('provider raw secret detail');
    });

    it('keeps TOTP enrollment material only in the in-memory enrollment ref with a unique safe label', async () => {
        const session = jwtSession('mfa-enroll');
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        await store.beginTotpEnrollment();
        await store.cancelTotpEnrollment();
        await store.beginTotpEnrollment();

        const friendlyNames = fixture.client.auth.mfa.enroll.mock.calls.map(([request]) => request.friendlyName);
        expect(friendlyNames).toHaveLength(2);
        expect(new Set(friendlyNames).size).toBe(2);
        expect(friendlyNames.every((name) => /^NEXERP Authenticator [a-z0-9-]+$/i.test(name))).toBe(true);
        expect(store.mfaStatus.value).toBe('enroll');
        expect(store.mfaEnrollment.value).toEqual({ factorId: 'totp-factor-1', qrCode: '<svg/>', secret: 'TEST-SECRET', uri: 'otpauth://totp/NEXERP:test?secret=TEST-SECRET' });
        expect(store.error.value || '').not.toContain('TEST-SECRET');
    });

    it('creates a new challenge for every TOTP verification attempt and consumes the verified session', async () => {
        const session = jwtSession('mfa-verify-before');
        const upgradedSession = jwtSession('mfa-verify-after', 1789257900);
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1')],
            mfaAal: { currentLevel: 'aal1', nextLevel: 'aal2' },
            mfaVerifyResult: { data: upgradedSession, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.refreshMfaState();

        await store.verifyTotpChallenge('totp-factor-1', '123456');
        await store.verifyTotpChallenge('totp-factor-1', '123456');

        expect(fixture.client.auth.mfa.challenge).toHaveBeenCalledTimes(2);
        expect(fixture.client.auth.mfa.verify).toHaveBeenCalledWith({ factorId: 'totp-factor-1', challengeId: 'challenge-1', code: '123456' });
        expect(store.session.value).toEqual(upgradedSession);
    });

    it('cleans an unverified enrollment on cancellation without retaining secret material', async () => {
        const session = jwtSession('mfa-cancel');
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.beginTotpEnrollment();

        await store.cancelTotpEnrollment();

        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'totp-factor-1' });
        expect(store.mfaEnrollment.value).toBeNull();
        expect(store.error.value || '').not.toContain('TEST-SECRET');
    });

    it('refuses to remove the last verified TOTP factor', async () => {
        const session = jwtSession('mfa-last-factor');
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.refreshMfaState();

        await expect(store.unenrollTotp('totp-factor-1')).rejects.toThrow('마지막 인증 앱은 삭제할 수 없습니다.');

        expect(fixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();
    });

    it('refreshes the session before recomputing MFA state after removing a backup factor', async () => {
        const session = jwtSession('mfa-remove-before');
        const refreshedSession = jwtSession('mfa-remove-after', 1789257900);
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' },
            refreshSessionResult: { data: { session: refreshedSession }, error: null }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.refreshMfaState();

        await store.unenrollTotp('totp-factor-2');

        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'totp-factor-2' });
        expect(fixture.client.auth.refreshSession).toHaveBeenCalledOnce();
        expect(store.session.value).toEqual(refreshedSession);
    });

    it('does not let a stale MFA lookup replace a newer identity state', async () => {
        const oldSession = jwtSession('mfa-stale-old', 1789257600, 'old-user');
        const newSession = jwtSession('mfa-stale-new', 1789257900, 'new-user');
        const staleFactors = deferred();
        const fixture = createClient({
            session: oldSession,
            profiles: {
                'old-user': { data: { ...approverProfile, id: 'old-user' }, error: null },
                'new-user': { data: { ...approverProfile, id: 'new-user', role: 'admin' }, error: null }
            }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        fixture.client.auth.mfa.listFactors.mockReturnValueOnce(staleFactors.promise);

        const checkingMfa = store.refreshMfaState();
        await fixture.emit('SIGNED_IN', newSession);
        staleFactors.resolve({ data: { all: [mfaFactor('old-factor')], totp: [mfaFactor('old-factor')] }, error: null });
        await checkingMfa;

        expect(store.user.value).toEqual(newSession.user);
        expect(store.mfaStatus.value).toBe('unknown');
        expect(store.mfaFactors.value).toEqual([]);
    });

    it('serializes concurrent same-tab backup-factor removals', async () => {
        const session = jwtSession('mfa-concurrent-remove');
        const unenroll = deferred();
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        fixture.client.auth.mfa.unenroll.mockReturnValueOnce(unenroll.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.refreshMfaState();

        const first = store.unenrollTotp('totp-factor-2');
        await expect(store.unenrollTotp('totp-factor-1')).rejects.toThrow('인증 앱 변경을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledTimes(1);

        unenroll.resolve({ data: { id: 'totp-factor-2' }, error: null });
        await first;
    });

    it('re-fetches authoritative factors before refusing a stale cached removal', async () => {
        const session = jwtSession('mfa-authoritative-remove');
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.refreshMfaState();
        fixture.client.auth.mfa.listFactors.mockResolvedValueOnce(mfaFactorResult([mfaFactor('totp-factor-2')]));

        await expect(store.unenrollTotp('totp-factor-2')).rejects.toThrow('마지막 인증 앱은 삭제할 수 없습니다.');

        expect(fixture.client.auth.mfa.listFactors).toHaveBeenCalledTimes(2);
        expect(fixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();
    });

    it('single-flights repeated TOTP enrollment and cleans existing unverified factors first', async () => {
        const session = jwtSession('mfa-concurrent-enroll');
        const enroll = deferred();
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } }, mfaFactors: [mfaFactor('old-unverified', 'unverified')] });
        fixture.client.auth.mfa.enroll.mockReturnValueOnce(enroll.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        const first = store.beginTotpEnrollment();
        await expect(store.beginTotpEnrollment()).rejects.toThrow('인증 앱 변경을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
        await vi.waitFor(() => expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old-unverified' }));
        expect(fixture.client.auth.mfa.enroll).toHaveBeenCalledTimes(1);

        enroll.resolve({ data: { id: 'new-factor', type: 'totp', totp: { qr_code: '<svg/>', secret: 'NEW-SECRET', uri: 'otpauth://totp/NEXERP:new?secret=NEW-SECRET' } }, error: null });
        await first;
        expect(store.mfaEnrollment.value?.factorId).toBe('new-factor');
    });

    it('discards a stale enrollment result without sending cleanup through the new identity session', async () => {
        const oldSession = jwtSession('mfa-stale-enroll-old', 1789257600, 'old-user');
        const newSession = jwtSession('mfa-stale-enroll-new', 1789257900, 'new-user');
        const enroll = deferred();
        const fixture = createClient({
            session: oldSession,
            profiles: {
                'old-user': { data: { ...approverProfile, id: 'old-user' }, error: null },
                'new-user': { data: { ...approverProfile, id: 'new-user' }, error: null }
            }
        });
        fixture.client.auth.mfa.enroll.mockReturnValueOnce(enroll.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        const enrolling = store.beginTotpEnrollment();
        await vi.waitFor(() => expect(fixture.client.auth.mfa.enroll).toHaveBeenCalledOnce());
        await fixture.emit('SIGNED_IN', newSession);
        enroll.resolve({ data: { id: 'stale-factor', type: 'totp', totp: { qr_code: '<svg/>', secret: 'STALE-SECRET', uri: 'otpauth://totp/NEXERP:stale?secret=STALE-SECRET' } }, error: null });
        await enrolling;

        expect(fixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();
        expect(store.mfaEnrollment.value).toBeNull();
        expect(store.error.value || '').not.toContain('STALE-SECRET');
        expect(JSON.stringify(store.mfaEnrollment.value)).not.toContain('otpauth://totp/NEXERP:stale');
    });

    it('best-effort cleans a superseded enrollment when its initiating session remains active', async () => {
        const session = jwtSession('mfa-superseded-enroll');
        const enroll = deferred();
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        fixture.client.auth.mfa.enroll.mockReturnValueOnce(enroll.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        const enrolling = store.beginTotpEnrollment();
        await vi.waitFor(() => expect(fixture.client.auth.mfa.enroll).toHaveBeenCalledOnce());
        await store.refreshMfaState();
        enroll.resolve({ data: { id: 'superseded-factor', type: 'totp', totp: { qr_code: '<svg/>', secret: 'SUPERSEDED-SECRET', uri: 'otpauth://totp/NEXERP:superseded?secret=SUPERSEDED-SECRET' } }, error: null });
        await enrolling;

        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'superseded-factor' });
        expect(store.mfaEnrollment.value).toBeNull();
        expect(JSON.stringify(store.mfaEnrollment.value)).not.toContain('SUPERSEDED-SECRET');
    });

    it('keeps a retryable cleanup handle but clears enrollment material when cancellation fails', async () => {
        const session = jwtSession('mfa-cancel-retry');
        const fixture = createClient({ session, profiles: { 'user-1': { data: approverProfile, error: null } } });
        fixture.client.auth.mfa.unenroll.mockResolvedValueOnce({ data: null, error: new Error('provider raw cleanup detail') }).mockResolvedValueOnce({ data: { id: 'totp-factor-1' }, error: null });
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();
        await store.beginTotpEnrollment();

        await expect(store.cancelTotpEnrollment()).rejects.toThrow('인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.mfaEnrollment.value).toEqual({ factorId: 'totp-factor-1', cleanupPending: true });
        expect(JSON.stringify(store.mfaEnrollment.value)).not.toContain('TEST-SECRET');

        await store.cancelTotpEnrollment();
        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledTimes(2);
        expect(store.mfaEnrollment.value).toBeNull();
    });

    it('allows a new identity mutation while an old identity enrollment is still pending', async () => {
        const oldSession = jwtSession('mfa-lock-old', 1789257600, 'old-user');
        const newSession = jwtSession('mfa-lock-new', 1789257900, 'new-user');
        const oldEnrollment = deferred();
        const newEnrollment = deferred();
        const fixture = createClient({
            session: oldSession,
            profiles: {
                'old-user': { data: { ...approverProfile, id: 'old-user' }, error: null },
                'new-user': { data: { ...approverProfile, id: 'new-user' }, error: null }
            }
        });
        fixture.client.auth.mfa.enroll.mockReturnValueOnce(oldEnrollment.promise).mockReturnValueOnce(newEnrollment.promise);
        const store = createAuthStore({ client: fixture.client, configured: true });
        await store.initialize();

        const oldMutation = store.beginTotpEnrollment();
        await vi.waitFor(() => expect(fixture.client.auth.mfa.enroll).toHaveBeenCalledOnce());
        expect(store.loading.value).toBe(true);
        await fixture.emit('SIGNED_IN', newSession);
        expect(store.loading.value).toBe(false);
        const newMutation = store.beginTotpEnrollment();
        await vi.waitFor(() => expect(fixture.client.auth.mfa.enroll).toHaveBeenCalledTimes(2));
        expect(store.loading.value).toBe(true);

        oldEnrollment.resolve({ data: { id: 'old-factor', type: 'totp', totp: { qr_code: '<svg/>', secret: 'OLD-SECRET', uri: 'otpauth://totp/NEXERP:old?secret=OLD-SECRET' } }, error: null });
        await oldMutation;
        await expect(store.beginTotpEnrollment()).rejects.toThrow('인증 앱 변경을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
        expect(store.loading.value).toBe(true);
        expect(store.mfaEnrollment.value).toBeNull();
        expect(JSON.stringify(store.mfaEnrollment.value)).not.toContain('OLD-SECRET');

        newEnrollment.resolve({ data: { id: 'new-factor', type: 'totp', totp: { qr_code: '<svg/>', secret: 'NEW-SECRET', uri: 'otpauth://totp/NEXERP:new?secret=NEW-SECRET' } }, error: null });
        await newMutation;
        expect(store.loading.value).toBe(false);
    });

    it('uses the same-origin factor lock while re-checking a backup-factor deletion', async () => {
        const session = jwtSession('mfa-web-lock');
        const pendingUnenroll = deferred();
        const queues = new Map();
        const locks = {
            request: vi.fn((name, callback) => {
                const previous = queues.get(name) || Promise.resolve();
                const queued = previous.catch(() => null).then(callback);
                queues.set(name, queued);
                return queued.finally(() => {
                    if (queues.get(name) === queued) queues.delete(name);
                });
            })
        };
        const firstFixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        const secondFixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        firstFixture.client.auth.mfa.unenroll.mockReturnValueOnce(pendingUnenroll.promise);
        const firstStore = createAuthStore({ client: firstFixture.client, configured: true, locks });
        const secondStore = createAuthStore({ client: secondFixture.client, configured: true, locks });
        await Promise.all([firstStore.initialize(), secondStore.initialize()]);

        const firstRemoval = firstStore.unenrollTotp('totp-factor-2');
        await vi.waitFor(() => expect(firstFixture.client.auth.mfa.unenroll).toHaveBeenCalledOnce());
        const secondRemoval = secondStore.unenrollTotp('totp-factor-1');
        expect(secondFixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();

        pendingUnenroll.resolve({ data: { id: 'totp-factor-2' }, error: null });
        await firstRemoval;
        await expect(secondRemoval).rejects.toThrow('마지막 인증 앱은 삭제할 수 없습니다.');
        expect(locks.request).toHaveBeenCalledWith('nexerp-mfa-totp:user-1', expect.any(Function));
        expect(secondFixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();
    });

    it('falls back to the authoritative factor check when Web Locks are unavailable', async () => {
        const session = jwtSession('mfa-no-web-lock');
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        const store = createAuthStore({ client: fixture.client, configured: true, locks: null });
        await store.initialize();

        await store.unenrollTotp('totp-factor-2');

        expect(fixture.client.auth.mfa.listFactors).toHaveBeenCalledTimes(2);
        expect(fixture.client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'totp-factor-2' });
    });

    it('normalizes a rejected Web Lock request without deleting a factor', async () => {
        const session = jwtSession('mfa-web-lock-rejection');
        const fixture = createClient({
            session,
            profiles: { 'user-1': { data: approverProfile, error: null } },
            mfaFactors: [mfaFactor('totp-factor-1'), mfaFactor('totp-factor-2')],
            mfaAal: { currentLevel: 'aal2', nextLevel: 'aal2' }
        });
        const locks = { request: vi.fn().mockRejectedValue(new Error('provider raw lock detail')) };
        const store = createAuthStore({ client: fixture.client, configured: true, locks });
        await store.initialize();

        await expect(store.unenrollTotp('totp-factor-2')).rejects.toThrow('인증 앱을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');

        expect(fixture.client.auth.mfa.listFactors).not.toHaveBeenCalled();
        expect(fixture.client.auth.mfa.unenroll).not.toHaveBeenCalled();
        expect(store.error.value).toBe('인증 앱을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(store.error.value).not.toContain('provider raw lock detail');
    });
});
