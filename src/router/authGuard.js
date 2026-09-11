export const createAuthGuard = (authStore) => async (to) => {
    try {
        await authStore.initialize();
    } catch {
        // The store owns user-facing error normalization. Navigation never exposes raw failures.
    }

    if (!authStore.configured.value) {
        return to.name === 'setup-required' ? true : { name: 'setup-required' };
    }

    const authenticated = Boolean(authStore.user.value);
    const active = authenticated && Boolean(authStore.profile.value?.is_active);

    if (to.meta.guestOnly && active) return '/';
    if (to.meta.public) return true;
    if (!authenticated) return { name: 'login', query: { redirect: to.fullPath } };
    if (to.name === 'access-denied') return true;
    if (!active) return { name: 'access-denied' };
    if (to.meta.roles && !authStore.hasRole(to.meta.roles)) return { name: 'access-denied' };

    return true;
};
