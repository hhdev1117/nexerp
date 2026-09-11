import { computed, ref } from 'vue';
import { getSupabaseClient } from '@/lib/supabase/client';
import { readSupabaseConfig } from '@/lib/supabase/config';

const PROFILE_FIELDS = 'id, email, display_name, department, role, is_active';
const NOT_CONFIGURED_MESSAGE = 'Supabase 연결 정보가 설정되지 않았습니다.';
const INACTIVE_PROFILE_MESSAGE = '비활성화된 계정입니다. 관리자에게 문의해 주세요.';
const MISSING_PROFILE_MESSAGE = '계정 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.';

const normalizedError = (source, fallback = '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.') => {
    const message = typeof source?.message === 'string' ? source.message.toLowerCase() : '';
    const status = Number(source?.status);

    if (status === 400 || status === 401 || message.includes('invalid login') || message.includes('invalid credentials')) {
        return '이메일 또는 비밀번호가 올바르지 않습니다.';
    }
    if (message.includes('network') || message.includes('failed to fetch') || message.includes('fetch failed')) {
        return '네트워크 연결을 확인한 후 다시 시도해 주세요.';
    }
    return fallback;
};

const rejection = (message) => {
    const authError = new Error(message);
    authError.name = 'AuthError';
    return authError;
};

export function createAuthStore({ client, configured }) {
    const session = ref(null);
    const user = ref(null);
    const profile = ref(null);
    const loading = ref(false);
    const initialized = ref(false);
    const error = ref(null);
    const profileLoadFailed = ref(false);
    const isConfigured = Boolean(configured && client);
    const configuredState = computed(() => isConfigured);
    const role = computed(() => (profile.value?.is_active ? profile.value.role || null : null));

    let initializePromise = null;
    let subscription = null;
    let identityVersion = 0;
    let pendingOperations = 0;
    let latestAuthUpdate = Promise.resolve();
    let nextSignOutOperationId = 0;
    const activeSignOutOperations = new Set();
    let bufferedSignedOut = false;

    const beginOperation = () => {
        pendingOperations += 1;
        loading.value = true;
    };

    const endOperation = () => {
        pendingOperations = Math.max(0, pendingOperations - 1);
        loading.value = pendingOperations > 0;
    };

    const clearIdentity = () => {
        identityVersion += 1;
        latestAuthUpdate = Promise.resolve();
        session.value = null;
        user.value = null;
        profile.value = null;
        profileLoadFailed.value = false;
        error.value = null;
    };

    const loadIdentity = async (nextSession) => {
        const version = ++identityVersion;
        const nextUser = nextSession?.user || null;
        const keepRecoverableFailure = Boolean(nextUser && user.value?.id === nextUser.id && profileLoadFailed.value);
        session.value = nextSession || null;
        user.value = nextUser;
        profile.value = null;
        if (!keepRecoverableFailure) {
            profileLoadFailed.value = false;
            error.value = null;
        }

        if (!nextUser) return;

        let result;
        try {
            result = await client.from('profiles').select(PROFILE_FIELDS).eq('id', nextUser.id).maybeSingle();
        } catch (cause) {
            result = { data: null, error: cause };
        }

        if (version !== identityVersion || user.value?.id !== nextUser.id) return;

        if (result.error) {
            profileLoadFailed.value = true;
            error.value = normalizedError(result.error, MISSING_PROFILE_MESSAGE);
            return;
        }
        if (!result.data) {
            profileLoadFailed.value = false;
            error.value = MISSING_PROFILE_MESSAGE;
            return;
        }

        profileLoadFailed.value = false;
        error.value = null;
        profile.value = result.data;
        if (!result.data.is_active) error.value = INACTIVE_PROFILE_MESSAGE;
    };

    const trackIdentity = (nextSession) => {
        latestAuthUpdate = (async () => {
            beginOperation();
            try {
                await loadIdentity(nextSession);
            } finally {
                endOperation();
            }
        })().catch(() => undefined);
        return latestAuthUpdate;
    };

    const awaitIdentitySettled = async () => {
        let update;
        let version;
        do {
            update = latestAuthUpdate;
            version = identityVersion;
            await update;
        } while (update !== latestAuthUpdate || version !== identityVersion);
    };

    const waitForIdentity = () => awaitIdentitySettled();

    const subscribe = () => {
        if (subscription || !isConfigured) return;

        const result = client.auth.onAuthStateChange((_event, nextSession) => {
            if (activeSignOutOperations.size > 0 && !nextSession) {
                bufferedSignedOut = true;
                return;
            }
            return trackIdentity(nextSession);
        });
        subscription = result?.data?.subscription || null;
    };

    const reconcileSession = async () => {
        const startingVersion = identityVersion;
        let response;
        try {
            response = await client.auth.getSession();
        } catch {
            return;
        }
        if (response?.error) return;
        if (identityVersion === startingVersion) trackIdentity(response?.data?.session || null);
        await awaitIdentitySettled();
    };

    const initialize = () => {
        if (initializePromise) return initializePromise;

        initializePromise = (async () => {
            beginOperation();
            try {
                if (!isConfigured) return;

                const startingVersion = identityVersion;
                subscribe();
                let response;
                try {
                    response = await client.auth.getSession();
                } catch (cause) {
                    if (identityVersion === startingVersion) {
                        error.value = normalizedError(cause, '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                    }
                    return;
                }
                const { data, error: sessionError } = response;
                if (sessionError) {
                    if (identityVersion === startingVersion) {
                        error.value = normalizedError(sessionError, '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                    }
                    return;
                }
                if (identityVersion === startingVersion) trackIdentity(data?.session || null);
            } finally {
                await awaitIdentitySettled();
                initialized.value = true;
                endOperation();
            }
        })();

        return initializePromise;
    };

    const signIn = async (email, password) => {
        if (!isConfigured) {
            error.value = NOT_CONFIGURED_MESSAGE;
            throw rejection(NOT_CONFIGURED_MESSAGE);
        }

        beginOperation();
        error.value = null;
        const startingVersion = identityVersion;
        try {
            let response;
            try {
                response = await client.auth.signInWithPassword({ email, password });
            } catch (cause) {
                const message = normalizedError(cause, '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                error.value = message;
                throw rejection(message);
            }
            const { data, error: signInError } = response;
            if (signInError) {
                const message = normalizedError(signInError, '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                error.value = message;
                throw rejection(message);
            }

            if (identityVersion === startingVersion) trackIdentity(data?.session || null);
            await awaitIdentitySettled();

            return { session: session.value, user: user.value };
        } finally {
            endOperation();
        }
    };

    const signOut = async () => {
        if (!isConfigured) {
            error.value = NOT_CONFIGURED_MESSAGE;
            throw rejection(NOT_CONFIGURED_MESSAGE);
        }

        beginOperation();
        const operationId = ++nextSignOutOperationId;
        activeSignOutOperations.add(operationId);
        let failureMessage = null;
        try {
            let response;
            try {
                response = await client.auth.signOut();
            } catch (cause) {
                const message = normalizedError(cause, '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                failureMessage = message;
                error.value = message;
                throw rejection(message);
            }
            const { error: signOutError } = response;
            if (signOutError) {
                const message = normalizedError(signOutError, '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                failureMessage = message;
                error.value = message;
                throw rejection(message);
            }
            bufferedSignedOut = false;
            clearIdentity();
        } finally {
            activeSignOutOperations.delete(operationId);
            if (activeSignOutOperations.size === 0 && bufferedSignedOut) {
                bufferedSignedOut = false;
                await reconcileSession();
                if (failureMessage && !error.value) error.value = failureMessage;
            }
            endOperation();
        }
    };

    const retryProfile = async () => {
        if (!isConfigured) {
            error.value = NOT_CONFIGURED_MESSAGE;
            throw rejection(NOT_CONFIGURED_MESSAGE);
        }
        if (!user.value || !session.value) {
            const message = '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.';
            error.value = message;
            throw rejection(message);
        }

        trackIdentity(session.value);
        await awaitIdentitySettled();

        if (!profile.value) throw rejection(error.value || MISSING_PROFILE_MESSAGE);
        return profile.value;
    };

    const hasRole = (roles) => Array.isArray(roles) && Boolean(profile.value?.is_active) && roles.includes(role.value);

    return {
        session,
        user,
        profile,
        role,
        loading,
        initialized,
        configured: configuredState,
        error,
        profileLoadFailed,
        initialize,
        waitForIdentity,
        signIn,
        signOut,
        retryProfile,
        hasRole
    };
}

let browserStore;

export function useAuthStore() {
    if (!browserStore) {
        const config = readSupabaseConfig(import.meta.env);
        browserStore = createAuthStore({ client: getSupabaseClient(), configured: config.configured });
    }
    return browserStore;
}
