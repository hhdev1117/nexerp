import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createAuthGuard } from './authGuard';

const makeStore = ({ configured = true, user = null, profile = null, initialize } = {}) => ({
    configured: ref(configured),
    user: ref(user),
    profile: ref(profile),
    initialize: initialize || vi.fn().mockResolvedValue(undefined),
    hasRole: vi.fn((roles) => Boolean(profile?.is_active) && roles.includes(profile.role))
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

    it('denies an ordinary user access to approvals', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const guard = createAuthGuard(store);

        await expect(guard(route({ name: 'approvals', fullPath: '/approvals', meta: { roles: ['admin', 'approver'] } }))).resolves.toEqual({ name: 'access-denied' });
    });

    it('allows an approver to visit approvals', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'approver', is_active: true } });
        const guard = createAuthGuard(store);

        await expect(guard(route({ name: 'approvals', fullPath: '/approvals', meta: { roles: ['admin', 'approver'] } }))).resolves.toBe(true);
    });

    it('denies an ordinary user access to access settings', async () => {
        const store = makeStore({ user: { id: 'user-1' }, profile: { role: 'user', is_active: true } });
        const guard = createAuthGuard(store);

        await expect(guard(route({ name: 'settings-access', fullPath: '/settings/access', meta: { roles: ['admin'] } }))).resolves.toEqual({ name: 'access-denied' });
    });

    it('allows an administrator to visit access settings', async () => {
        const store = makeStore({ user: { id: 'admin-1' }, profile: { role: 'admin', is_active: true } });
        const guard = createAuthGuard(store);

        await expect(guard(route({ name: 'settings-access', fullPath: '/settings/access', meta: { roles: ['admin'] } }))).resolves.toBe(true);
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
});
