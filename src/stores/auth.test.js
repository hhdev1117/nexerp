import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const createClient = ({ session = null, profiles = {}, signInResult, signOutError = null } = {}) => {
    let authListener;
    const unsubscribe = vi.fn();
    const profileRequests = [];
    const client = {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
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
            signOut: vi.fn().mockResolvedValue({ error: signOutError })
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

    it('keeps local identity when sign-out fails and clears it only after success', async () => {
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'disabled@nexerp.test' } };
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
        const session = { user: { id: 'missing-user', email: 'missing@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const session = { user: { id: 'user-1', email: 'approver@nexerp.test' } };
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
        const oldSession = { user: { id: 'old-user', email: 'old@nexerp.test' } };
        const newSession = { user: { id: 'new-user', email: 'new@nexerp.test' } };
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
});
