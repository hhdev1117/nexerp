import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createAuthGuard } from './authGuard';

function fixture(mode = 'active', keys = []) {
    const auth = { initialize: async () => {}, configured: ref(true), user: ref({ id: 'actor' }), profile: ref({ role: 'admin', is_active: true }), refreshMfaState: async () => ({ status: 'ready' }), hasRole: () => true };
    const legacy = { ensureLoaded: vi.fn(), canAccess: vi.fn(() => true) };
    const runtime = { context: ref({ mode, companyId: 'company', menuKeys: keys }), refresh: vi.fn(async () => {}), reset: vi.fn(), canAccess: (key) => keys.includes(key) };
    return { auth, legacy, runtime, guard: createAuthGuard(auth, legacy, runtime) };
}
describe('published enterprise route permissions', () => {
    it('does not let legacy administrator bypass a published menu denial', async () => {
        const { guard, legacy, runtime } = fixture();
        expect(await guard({ meta: { menuKey: 'sales.orders' }, fullPath: '/sales/orders' })).toEqual({ name: 'access-denied' });
        expect(runtime.refresh).toHaveBeenCalled();
        expect(legacy.canAccess).not.toHaveBeenCalled();
    });
    it('retains legacy checks when no policy is published', async () => {
        const { guard, legacy } = fixture('legacy');
        expect(await guard({ meta: { menuKey: 'sales.orders' }, fullPath: '/sales/orders' })).toBe(true);
        expect(legacy.canAccess).toHaveBeenCalled();
    });
    it('denies business routes on runtime lookup failure but preserves admin recovery', async () => {
        const { guard, runtime } = fixture();
        runtime.refresh.mockRejectedValue(new Error('network'));
        expect(await guard({ meta: { menuKey: 'sales.orders' }, fullPath: '/sales/orders' })).toEqual({ name: 'access-denied' });
        expect(await guard({ meta: { menuKey: 'settings.enterprise-access', roles: ['admin'], fixedAccess: true }, fullPath: '/settings/enterprise-access' })).toBe(true);
    });
    it('checks identity again after the runtime request resolves', async () => {
        const { guard, runtime, auth } = fixture('active', ['sales.orders']);
        runtime.refresh.mockImplementation(async () => { auth.user.value = { id: 'other' }; });
        expect(await guard({ meta: { menuKey: 'sales.orders' }, fullPath: '/sales/orders' })).not.toBe(true);
    });
});
