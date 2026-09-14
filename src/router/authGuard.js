export const safeLocalRedirect = (value) => {
    if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || value.includes('\\')) return '/';
    const path = value.split(/[?#]/, 1)[0];
    return path === '/auth/login' || path === '/auth/mfa' ? '/' : value;
};

export const createAuthGuard = (authStore, accessStore, runtimeStore = null) => async (to) => {
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
    if (!active) runtimeStore?.reset();
    const authenticatedUserId = authStore.user.value?.id;
    const isSameActiveIdentity = () => authStore.user.value?.id === authenticatedUserId && Boolean(authStore.profile.value?.is_active);

    const isMfaRoute = to.name === 'mfa';
    if (to.meta.guestOnly) {
        if (!active) return true;
        const redirect = safeLocalRedirect(to.query?.redirect);
        let mfaResult = null;
        try {
            mfaResult = await authStore.refreshMfaState?.();
        } catch {
            // An active session with an unavailable MFA lookup must not bypass verification.
        }
        if (!isSameActiveIdentity()) return { name: 'mfa', query: { redirect: '/' } };
        return mfaResult?.status === 'ready' ? redirect : { name: 'mfa', query: { redirect } };
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
    let mfaResult = null;
    try {
        mfaResult = await authStore.refreshMfaState?.();
    } catch {
        // MFA state is deliberately fail-closed and retried only from its dedicated screen.
    }
    if (!isSameActiveIdentity()) {
        if (!authStore.user.value) return { name: 'login', query: { redirect: '/' } };
        if (!authStore.profile.value?.is_active) return { name: 'access-denied' };
        return { name: 'mfa', query: { redirect: '/' } };
    }
    if (isMfaRoute) return mfaResult?.status === 'ready' ? safeLocalRedirect(to.query?.redirect) : true;
    if (mfaResult?.status !== 'ready') return { name: 'mfa', query: { redirect: safeLocalRedirect(to.fullPath) } };
    if (to.meta.roles && !authStore.hasRole(to.meta.roles)) return { name: 'access-denied' };
    if (runtimeStore && to.meta.menuKey && !to.meta.fixedAccess) {
        try {
            await runtimeStore.refresh(authenticatedUserId, runtimeStore.context.value?.companyId || null);
        } catch {
            return { name: 'access-denied' };
        }
        if (!isSameActiveIdentity() || !runtimeStore.context.value) return { name: 'access-denied' };
        if (runtimeStore.context.value.mode === 'active') return runtimeStore.canAccess(to.meta.menuKey) ? true : { name: 'access-denied' };
        if (runtimeStore.context.value.mode !== 'legacy') return { name: 'access-denied' };
    }
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
