import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createAuthStore } from '@/stores/auth';
import { createAuthGuard } from './authGuard';

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

const createActualStoreFixture = ({ session, profileResults }) => {
    let authListener;
    let profileRequestIndex = 0;
    const client = {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
            getUser: vi.fn().mockResolvedValue({ data: { user: session?.user || null }, error: null }),
            onAuthStateChange: vi.fn((listener) => {
                authListener = listener;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
            signInWithPassword: vi.fn(),
            signOut: vi.fn().mockResolvedValue({ error: null })
        },
        from: vi.fn(() => ({
            select() {
                return this;
            },
            eq() {
                return this;
            },
            maybeSingle() {
                const result = profileResults[profileRequestIndex++];
                return result instanceof Promise ? result : Promise.resolve(result);
            }
        }))
    };
    const store = createAuthStore({ client, configured: true });

    return {
        store,
        client,
        emit(event, nextSession) {
            return authListener(event, nextSession);
        }
    };
};

const makeStore = ({ configured = true, user = null, profile = null, initialize } = {}) => ({
    configured: ref(configured),
    user: ref(user),
    profile: ref(profile),
    initialize: initialize || vi.fn().mockResolvedValue(undefined),
    hasRole: vi.fn((roles) => Boolean(profile?.is_active) && roles.includes(profile.role))
});

const makeAccessStore = ({ allowed = true, loadError } = {}) => ({
    ensureLoaded: loadError ? vi.fn().mockRejectedValue(loadError) : vi.fn().mockResolvedValue(undefined),
    canAccess: vi.fn(() => allowed)
});

const route = (overrides = {}) => ({
    name: 'dashboard',
    fullPath: '/',
    meta: {},
    ...overrides
});

describe('authentication route guard', () => {
    it('sends an unconfigured deployment to setup', async () => {
        const guard = createAuthGuard(makeStore({ configured: false }));

        await expect(guard(route({ fullPath: '/sales/orders' }))).resolves.toEqual({ name: 'setup-required' });
    });

    it('allows the setup route without a redirect loop', async () => {
        const guard = createAuthGuard(makeStore({ configured: false }));

        await expect(guard(route({ name: 'setup-required', fullPath: '/auth/setup', meta: { public: true } }))).resolves.toBe(true);
    });

    it('allows configured anonymous users to visit the public login route', async () => {
        const guard = createAuthGuard(makeStore());

        await expect(guard(route({ name: 'login', fullPath: '/auth/login', meta: { public: true, guestOnly: true } }))).resolves.toBe(true);
    });

    it('preserves the full protected destination for anonymous login', async () => {
        const guard = createAuthGuard(makeStore());

        await expect(guard(route({ fullPath: '/sales/orders?status=open' }))).resolves.toEqual({ name: 'login', query: { redirect: '/sales/orders?status=open' } });
    });

    it('redirects an authenticated active user away from guest-only routes', async () => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } }));

        await expect(guard(route({ name: 'login', fullPath: '/auth/login', meta: { public: true, guestOnly: true } }))).resolves.toBe('/');
    });

    it.each([
        ['missing', null],
        ['inactive', { role: 'user', is_active: false }]
    ])('allows an authenticated user with a %s profile to stay on a guest-only route', async (_state, profile) => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile }));

        await expect(guard(route({ name: 'login', fullPath: '/auth/login', meta: { public: true, guestOnly: true } }))).resolves.toBe(true);
    });

    it('denies a user with a missing profile access to a role-less ERP route', async () => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile: null }));

        await expect(guard(route({ name: 'sales-orders', fullPath: '/sales/orders' }))).resolves.toEqual({ name: 'access-denied' });
    });

    it('denies a user with an inactive profile access to a role-less ERP route', async () => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: false } }));

        await expect(guard(route({ name: 'sales-orders', fullPath: '/sales/orders' }))).resolves.toEqual({ name: 'access-denied' });
    });

    it.each([
        ['missing', null],
        ['inactive', { role: 'user', is_active: false }]
    ])('allows an authenticated user with a %s profile to visit access denied', async (_state, profile) => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile }));

        await expect(guard(route({ name: 'access-denied', fullPath: '/auth/access-denied' }))).resolves.toBe(true);
    });

    it('denies an ordinary user access to approvals when the dynamic menu key is absent', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore({ allowed: false });
        const guard = createAuthGuard(store, accessStore);

        await expect(guard(route({ name: 'approvals', fullPath: '/approvals', meta: { menuKey: 'approvals' } }))).resolves.toEqual({ name: 'access-denied' });
    });

    it('allows an ordinary user to visit approvals when the dynamic menu key is granted', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore({ allowed: true });
        const guard = createAuthGuard(store, accessStore);

        await expect(guard(route({ name: 'approvals', fullPath: '/approvals', meta: { menuKey: 'approvals' } }))).resolves.toBe(true);
        expect(accessStore.canAccess).toHaveBeenCalledWith('approvals', 'user');
    });

    it('denies direct navigation when the loaded role does not allow the route menu key', async () => {
        const authStore = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore({ allowed: false });
        const guard = createAuthGuard(authStore, accessStore);

        await expect(guard(route({ name: 'sales-orders', fullPath: '/sales/orders', meta: { menuKey: 'sales.orders' } }))).resolves.toEqual({ name: 'access-denied' });
        expect(accessStore.ensureLoaded).toHaveBeenCalledWith('user');
        expect(accessStore.canAccess).toHaveBeenCalledWith('sales.orders', 'user');
    });

    it('allows direct navigation when the same menu key is allowed by the access store', async () => {
        const authStore = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore();
        const guard = createAuthGuard(authStore, accessStore);

        await expect(guard(route({ name: 'sales-orders', fullPath: '/sales/orders', meta: { menuKey: 'sales.orders' } }))).resolves.toBe(true);
    });

    it('fails closed without leaking details when dynamic access loading rejects', async () => {
        const authStore = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore({ loadError: new Error('sentinel-secret-access-detail') });
        const guard = createAuthGuard(authStore, accessStore);

        const result = await guard(route({ name: 'sales-orders', fullPath: '/sales/orders', meta: { menuKey: 'sales.orders' } }));

        expect(result).toEqual({ name: 'access-denied' });
        expect(JSON.stringify(result)).not.toContain('sentinel-secret-access-detail');
        expect(accessStore.canAccess).not.toHaveBeenCalled();
    });

    it('denies an ordinary user access to fixed administrator settings', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const accessStore = makeAccessStore();
        const guard = createAuthGuard(store, accessStore);

        await expect(guard(route({ name: 'settings-accounts', fullPath: '/settings/accounts', meta: { roles: ['admin'], menuKey: 'settings.accounts', fixedAccess: true } }))).resolves.toEqual({ name: 'access-denied' });
        expect(accessStore.ensureLoaded).not.toHaveBeenCalled();
    });

    it('allows an administrator to visit fixed settings without consulting dynamic permissions', async () => {
        const store = makeStore({ user: { id: 'admin-1' }, profile: { role: 'admin', is_active: true } });
        const accessStore = makeAccessStore({ allowed: false });
        const guard = createAuthGuard(store, accessStore);

        await expect(guard(route({ name: 'settings-accounts', fullPath: '/settings/accounts', meta: { roles: ['admin'], menuKey: 'settings.accounts', fixedAccess: true } }))).resolves.toBe(true);
        expect(accessStore.ensureLoaded).not.toHaveBeenCalled();
        expect(accessStore.canAccess).not.toHaveBeenCalled();
    });

    it('allows authenticated users to visit access denied without a role loop', async () => {
        const guard = createAuthGuard(makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } }));

        await expect(guard(route({ name: 'access-denied', fullPath: '/auth/access-denied' }))).resolves.toBe(true);
    });

    it('initializes the auth store before making a decision', async () => {
        const initialize = vi.fn().mockResolvedValue(undefined);
        const store = makeStore({ initialize });
        const guard = createAuthGuard(store);

        await guard(route({ name: 'login', fullPath: '/auth/login', meta: { public: true } }));

        expect(initialize).toHaveBeenCalledOnce();
    });

    it('normalizes initialization failures without exposing their text', async () => {
        const initialize = vi.fn().mockRejectedValue(new Error('sentinel-secret-initialize-detail'));
        const guard = createAuthGuard(makeStore({ initialize }));

        const result = await guard(route({ fullPath: '/finance/summary?period=2026' }));

        expect(result).toEqual({ name: 'login', query: { redirect: '/finance/summary?period=2026' } });
        expect(JSON.stringify(result)).not.toContain('sentinel-secret-initialize-detail');
    });

    it.each(['TOKEN_REFRESHED', 'SIGNED_IN'])('waits for an active approver profile during %s before authorizing', async (event) => {
        const session = { user: { id: 'approver-1', email: 'approver@nexerp.test' } };
        const approverProfile = { id: 'approver-1', email: session.user.email, display_name: 'Approver', department: 'Finance', role: 'approver', is_active: true };
        const refreshedProfile = deferred();
        const fixture = createActualStoreFixture({
            session,
            profileResults: [{ data: approverProfile, error: null }, refreshedProfile.promise]
        });
        await fixture.store.initialize();

        const refresh = fixture.emit(event, session);
        let guardSettled = false;
        const decision = createAuthGuard(fixture.store)(route({ name: 'approvals', fullPath: '/approvals', meta: { roles: ['admin', 'approver'] } })).then((result) => {
            guardSettled = true;
            return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const settledWhileRefreshing = guardSettled;
        const loadingWhileRefreshing = fixture.store.loading.value;

        refreshedProfile.resolve({ data: approverProfile, error: null });
        await refresh;

        expect(settledWhileRefreshing).toBe(false);
        expect(loadingWhileRefreshing).toBe(true);
        await expect(decision).resolves.toBe(true);
        expect(fixture.store.loading.value).toBe(false);
    });

    it('allows protected navigation after a failed profile request is retried', async () => {
        const session = { user: { id: 'approver-1', email: 'approver@nexerp.test' } };
        const approverProfile = { id: 'approver-1', email: session.user.email, display_name: 'Approver', department: 'Finance', role: 'approver', is_active: true };
        const fixture = createActualStoreFixture({
            session,
            profileResults: [
                { data: null, error: new TypeError('Failed to fetch private profile endpoint') },
                { data: approverProfile, error: null }
            ]
        });
        const guard = createAuthGuard(fixture.store);
        const approvals = route({ name: 'approvals', fullPath: '/approvals', meta: { roles: ['admin', 'approver'] } });

        await expect(guard(approvals)).resolves.toEqual({ name: 'access-denied', query: { redirect: '/approvals' } });
        await fixture.store.retryProfile();

        expect(fixture.client.from).toHaveBeenCalledTimes(2);
        await expect(guard(approvals)).resolves.toBe(true);
    });

    it('allows login immediately after sign-out invalidates a deferred profile retry', async () => {
        const session = { user: { id: 'approver-1', email: 'approver@nexerp.test' } };
        const approverProfile = { id: 'approver-1', email: session.user.email, display_name: 'Approver', department: 'Finance', role: 'approver', is_active: true };
        const staleProfileRetry = deferred();
        const fixture = createActualStoreFixture({
            session,
            profileResults: [{ data: approverProfile, error: null }, staleProfileRetry.promise]
        });
        await fixture.store.initialize();
        const retrying = fixture.store.retryProfile().catch((authError) => authError);
        expect(fixture.store.loading.value).toBe(true);

        await fixture.store.signOut();
        const login = route({ name: 'login', fullPath: '/auth/login', meta: { public: true, guestOnly: true } });
        let navigationSettled = false;
        let navigationResult;
        const navigation = createAuthGuard(fixture.store)(login).then((result) => {
            navigationSettled = true;
            navigationResult = result;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const settledBeforeStaleRequest = navigationSettled;
        const resultBeforeStaleRequest = navigationResult;
        const loadingBeforeStaleRequest = fixture.store.loading.value;

        staleProfileRetry.resolve({ data: approverProfile, error: null });
        await Promise.all([retrying, navigation]);

        expect(settledBeforeStaleRequest).toBe(true);
        expect(resultBeforeStaleRequest).toBe(true);
        expect(loadingBeforeStaleRequest).toBe(true);
        expect(fixture.store.user.value).toBeNull();
        expect(fixture.store.profile.value).toBeNull();
        expect(fixture.store.loading.value).toBe(false);
    });
});
