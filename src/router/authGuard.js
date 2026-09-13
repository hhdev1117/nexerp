export const safeLocalRedirect = (value) => {
    if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || value.includes('\\')) return '/';
    const path = value.split(/[?#]/, 1)[0];
    return path === '/auth/login' || path === '/auth/mfa' ? '/' : value;
};

export const createAuthGuard = (authStore, accessStore) => async (to) => {
    try {
        await authStore.initialize();
        if (typeof authStore.waitForIdentity === 'function') await authStore.waitForIdentity();
    } catch {
        // The store owns user-facing error normalization. Navigation never exposes raw failures.
    }

    if (!authStore.configured.value) {
        return to.name === 'setup-required' ? true : { name: 'setup-required' };
    }

    const authenticated = Boolean(authStore.user.value);
    const active = authenticated && Boolean(authStore.profile.value?.is_active);

    const isMfaRoute = to.name === 'mfa';
    if (to.meta.guestOnly) {
        if (!active) return true;
        try {
            await authStore.refreshMfaState?.();
        } catch {
            // An active session with an unavailable MFA lookup must not bypass verification.
        }
        return authStore.mfaStatus?.value === 'ready' ? '/' : { name: 'mfa', query: { redirect: '/' } };
    }
    if (to.meta.public && !isMfaRoute) return true;
    if (!authenticated) {
        return {
            name: 'login',
            query: { redirect: isMfaRoute ? safeLocalRedirect(to.query?.redirect) : safeLocalRedirect(to.fullPath) }
        };
    }
    if (to.name === 'access-denied') return true;
    if (!active) {
        return authStore.profileLoadFailed?.value ? { name: 'access-denied', query: { redirect: to.fullPath } } : { name: 'access-denied' };
    }
    try {
        await authStore.refreshMfaState?.();
    } catch {
        // MFA state is deliberately fail-closed and retried only from its dedicated screen.
    }
    if (isMfaRoute) return authStore.mfaStatus?.value === 'ready' ? safeLocalRedirect(to.query?.redirect) : true;
    if (authStore.mfaStatus?.value !== 'ready') return { name: 'mfa', query: { redirect: safeLocalRedirect(to.fullPath) } };
    if (to.meta.roles && !authStore.hasRole(to.meta.roles)) return { name: 'access-denied' };
    if (to.meta.menuKey && !to.meta.fixedAccess) {
        if (!accessStore) return { name: 'access-denied' };

        try {
            await accessStore.ensureLoaded(authStore.profile.value.role);
        } catch {
            return { name: 'access-denied' };
        }

        if (!accessStore.canAccess(to.meta.menuKey, authStore.profile.value.role)) return { name: 'access-denied' };
    }

    return true;
};
