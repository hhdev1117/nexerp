import { computed, ref } from 'vue';
import { getSupabaseClient } from '@/lib/supabase/client';
import { readSupabaseConfig } from '@/lib/supabase/config';

const PROFILE_FIELDS = 'id, email, display_name, department, role, is_active';
const NOT_CONFIGURED_MESSAGE = 'Supabase 연결 정보가 설정되지 않았습니다.';
const INACTIVE_PROFILE_MESSAGE = '비활성화된 계정입니다. 관리자에게 문의해 주세요.';
const MISSING_PROFILE_MESSAGE = '계정 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.';
const MFA_LOOKUP_MESSAGE = '다중 인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const MFA_ENROLLMENT_MESSAGE = '인증 앱을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const MFA_VERIFICATION_MESSAGE = '인증 코드를 확인하지 못했습니다. 다시 입력해 주세요.';
const MFA_CANCELLATION_MESSAGE = '인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const MFA_UNENROLLMENT_MESSAGE = '인증 앱을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const MFA_CODE_MESSAGE = '인증 앱의 6자리 코드를 입력해 주세요.';
const MFA_LAST_FACTOR_MESSAGE = '마지막 인증 앱은 삭제할 수 없습니다.';
const MFA_IDENTITY_MESSAGE = '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.';
const MFA_MUTATION_MESSAGE = '인증 앱 변경을 처리 중입니다. 잠시 후 다시 시도해 주세요.';
const INVALID_SESSION_NAMES = new Set(['AuthSessionMissingError', 'AuthInvalidJwtError', 'AuthInvalidTokenResponseError']);
const INVALID_SESSION_CODES = new Set(['session_not_found', 'bad_jwt', 'invalid_jwt']);
const TOTP_CODE_PATTERN = /^\d{6}$/;

const isInvalidSessionError = (source) => INVALID_SESSION_NAMES.has(source?.name) || INVALID_SESSION_CODES.has(source?.code) || source?.status === 401 || source?.status === 403;

const authSessionKey = (authSession) => {
    const token = authSession?.access_token;
    if (typeof token !== 'string' || !token.trim()) return null;
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            // The unverified claim is only a rejection key; getUser still verifies stored credentials.
            if (typeof claims?.session_id === 'string' && claims.session_id.trim()) return `session:${claims.session_id}`;
        }
    } catch {
        // Opaque or malformed credentials remain rejectable without exposing their contents.
    }
    // Without a session ID, conservatively group token rotations by user until explicit sign-in.
    const userId = authSession?.user?.id;
    return typeof userId === 'string' && userId ? `user:${userId}` : `token:${token}`;
};

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

export function createAuthStore({ client, configured, locks = typeof window === 'undefined' ? null : window.navigator?.locks }) {
    const session = ref(null);
    const user = ref(null);
    const profile = ref(null);
    const loading = ref(false);
    const initialized = ref(false);
    const error = ref(null);
    const profileLoadFailed = ref(false);
    const mfaStatus = ref('unknown');
    const mfaFactors = ref([]);
    const mfaEnrollment = ref(null);
    const isConfigured = Boolean(configured && client);
    const configuredState = computed(() => isConfigured);
    const role = computed(() => (profile.value?.is_active ? profile.value.role || null : null));
    const mfaSatisfied = computed(() => mfaStatus.value === 'ready');

    let initializePromise = null;
    let subscription = null;
    let identityVersion = 0;
    let pendingOperations = 0;
    const mfaLoadingTickets = new Set();
    let latestAuthUpdate = Promise.resolve();
    let nextSignOutOperationId = 0;
    const activeSignOutOperations = new Set();
    let bufferedSignedOut = false;
    let hydratingStoredSession = false;
    let bufferedInitialAuth = null;
    const rejectedAuthSessions = new Set();
    let mfaOperationVersion = 0;
    let mfaMutation = null;
    let nextTotpLabelNumber = 0;
    const isRejectedSession = (nextSession) => {
        if (!nextSession) return false;
        const key = authSessionKey(nextSession);
        return !key || rejectedAuthSessions.has(key);
    };

    const updateLoading = () => {
        loading.value = pendingOperations > 0 || mfaLoadingTickets.size > 0;
    };

    const beginOperation = () => {
        pendingOperations += 1;
        updateLoading();
    };

    const endOperation = () => {
        pendingOperations = Math.max(0, pendingOperations - 1);
        updateLoading();
    };

    const clearMfaState = () => {
        mfaOperationVersion += 1;
        mfaMutation = null;
        mfaLoadingTickets.clear();
        mfaStatus.value = 'unknown';
        mfaFactors.value = [];
        mfaEnrollment.value = null;
        updateLoading();
    };

    const clearIdentity = () => {
        identityVersion += 1;
        latestAuthUpdate = Promise.resolve();
        session.value = null;
        user.value = null;
        profile.value = null;
        profileLoadFailed.value = false;
        clearMfaState();
        error.value = null;
    };

    const loadIdentity = async (nextSession) => {
        const version = ++identityVersion;
        const previousSession = session.value;
        const previousUser = user.value;
        const nextUser = nextSession?.user || null;
        const identityChanged = previousUser?.id !== nextUser?.id || authSessionKey(previousSession) !== authSessionKey(nextSession);
        if (identityChanged) clearMfaState();
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
        if (isRejectedSession(nextSession)) return latestAuthUpdate;
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

    const isSameAuthSession = (left, right) => {
        const sameUser = left?.user?.id && left.user.id === right?.user?.id;
        const leftKey = authSessionKey(left);
        const rightKey = authSessionKey(right);
        return Boolean(sameUser && (!leftKey || !rightKey || leftKey === rightKey));
    };

    const startMfaOperation = () => ({
        version: ++mfaOperationVersion,
        userId: user.value?.id || null,
        sessionKey: authSessionKey(session.value)
    });

    const isSameMfaIdentity = (operation) => operation.userId === user.value?.id && operation.sessionKey === authSessionKey(session.value);

    const isCurrentMfaOperation = (operation) => operation.version === mfaOperationVersion && isSameMfaIdentity(operation);

    const beginMfaLoading = (operation) => {
        const ticket = { userId: operation.userId, sessionKey: operation.sessionKey };
        mfaLoadingTickets.add(ticket);
        updateLoading();
        return ticket;
    };

    const endMfaLoading = (ticket) => {
        mfaLoadingTickets.delete(ticket);
        updateLoading();
    };

    const requireMfaIdentity = () => {
        if (!isConfigured || !session.value || !user.value?.id || !profile.value?.is_active) {
            error.value = isConfigured ? MFA_IDENTITY_MESSAGE : NOT_CONFIGURED_MESSAGE;
            throw rejection(error.value);
        }
    };

    const verifiedTotpFactors = (result) => {
        const factors = Array.isArray(result?.data?.totp) ? result.data.totp : [];
        return factors.filter((factor) => factor?.factor_type === 'totp' && factor.status === 'verified' && typeof factor.id === 'string' && factor.id.trim());
    };

    const unverifiedTotpFactors = (result) => {
        const factors = Array.isArray(result?.data?.all) ? result.data.all : [];
        return factors.filter((factor) => factor?.factor_type === 'totp' && factor.status === 'unverified' && typeof factor.id === 'string' && factor.id.trim());
    };

    const currentMfaMutationScope = () => ({ userId: user.value?.id || null, sessionKey: authSessionKey(session.value) });

    const runMfaMutation = (task) => {
        const scope = currentMfaMutationScope();
        if (mfaMutation?.userId === scope.userId && mfaMutation?.sessionKey === scope.sessionKey) return Promise.reject(rejection(MFA_MUTATION_MESSAGE));
        const pending = Promise.resolve().then(task);
        const mutation = { ...scope, pending };
        mfaMutation = mutation;
        return pending.finally(() => {
            if (mfaMutation === mutation) mfaMutation = null;
        });
    };

    const nextTotpFriendlyName = () => {
        const browserCrypto = typeof window === 'undefined' ? null : window.crypto;
        const identifier = typeof browserCrypto?.randomUUID === 'function' ? browserCrypto.randomUUID() : `${Date.now().toString(36)}-${++nextTotpLabelNumber}`;
        return `NEXERP Authenticator ${identifier}-${++nextTotpLabelNumber}`;
    };

    const bestEffortUnenroll = async (mfaApi, factorId) => {
        try {
            await mfaApi.unenroll({ factorId });
        } catch {
            // The unverified factor is short-lived; do not retain its ID or credentials for a retry.
        }
    };

    const withTotpFactorLock = async (operation, task) => {
        if (typeof locks?.request !== 'function') return task();
        try {
            return await locks.request(`nexerp-mfa-totp:${operation.userId}`, async () => {
                if (!isCurrentMfaOperation(operation)) return null;
                return task();
            });
        } catch (cause) {
            if (cause?.name === 'AuthError') throw cause;
            return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
        }
    };

    const failMfaOperation = (operation, message, status = null) => {
        if (isCurrentMfaOperation(operation)) {
            if (status) mfaStatus.value = status;
            error.value = message;
        }
        throw rejection(message);
    };

    const refreshMfaState = async () => {
        requireMfaIdentity();
        const operation = startMfaOperation();
        mfaStatus.value = 'unknown';
        mfaFactors.value = [];
        const loadingTicket = beginMfaLoading(operation);
        try {
            let factorsResult;
            let assuranceResult;
            try {
                [factorsResult, assuranceResult] = await Promise.all([client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel()]);
            } catch {
                return failMfaOperation(operation, MFA_LOOKUP_MESSAGE, 'error');
            }
            if (!isCurrentMfaOperation(operation)) return null;
            if (factorsResult?.error || assuranceResult?.error || !assuranceResult?.data) return failMfaOperation(operation, MFA_LOOKUP_MESSAGE, 'error');

            const factors = verifiedTotpFactors(factorsResult);
            mfaFactors.value = factors;
            mfaStatus.value = factors.length && assuranceResult.data.currentLevel === 'aal2' ? 'ready' : factors.length ? 'challenge' : 'enroll';
            error.value = null;
            return { status: mfaStatus.value, factors };
        } finally {
            endMfaLoading(loadingTicket);
        }
    };

    const beginTotpEnrollment = () =>
        runMfaMutation(async () => {
            requireMfaIdentity();
            if (mfaEnrollment.value?.cleanupPending) {
                error.value = MFA_CANCELLATION_MESSAGE;
                throw rejection(MFA_CANCELLATION_MESSAGE);
            }

            const operation = startMfaOperation();
            const mfaApi = client.auth.mfa;
            const loadingTicket = beginMfaLoading(operation);
            try {
                let existingFactors;
                try {
                    existingFactors = await mfaApi.listFactors();
                } catch {
                    return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');
                }
                if (!isCurrentMfaOperation(operation)) return null;
                if (existingFactors?.error || !Array.isArray(existingFactors?.data?.all)) return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');

                for (const factor of unverifiedTotpFactors(existingFactors)) {
                    let cleanup;
                    try {
                        cleanup = await mfaApi.unenroll({ factorId: factor.id });
                    } catch {
                        return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');
                    }
                    if (!isCurrentMfaOperation(operation)) return null;
                    if (cleanup?.error) return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');
                }

                let result;
                try {
                    result = await mfaApi.enroll({ factorType: 'totp', friendlyName: nextTotpFriendlyName(), issuer: 'NEXERP' });
                } catch {
                    return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');
                }
                const data = result?.data;
                if (!isCurrentMfaOperation(operation)) {
                    if (isSameMfaIdentity(operation) && typeof data?.id === 'string' && data.id.trim()) await bestEffortUnenroll(mfaApi, data.id);
                    return null;
                }
                if (result?.error || typeof data?.id !== 'string' || typeof data?.totp?.qr_code !== 'string' || typeof data.totp.secret !== 'string' || typeof data.totp.uri !== 'string') {
                    return failMfaOperation(operation, MFA_ENROLLMENT_MESSAGE, 'error');
                }

                mfaEnrollment.value = { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
                mfaStatus.value = 'enroll';
                error.value = null;
                return mfaEnrollment.value;
            } finally {
                endMfaLoading(loadingTicket);
            }
        });

    const verifyTotpFactor = async (factorId, code, clearEnrollment) => {
        requireMfaIdentity();
        if (typeof factorId !== 'string' || !factorId.trim()) {
            error.value = MFA_VERIFICATION_MESSAGE;
            throw rejection(MFA_VERIFICATION_MESSAGE);
        }
        if (typeof code !== 'string' || !TOTP_CODE_PATTERN.test(code)) {
            error.value = MFA_CODE_MESSAGE;
            throw rejection(MFA_CODE_MESSAGE);
        }

        const operation = startMfaOperation();
        const loadingTicket = beginMfaLoading(operation);
        try {
            let challenge;
            try {
                challenge = await client.auth.mfa.challenge({ factorId });
            } catch {
                return failMfaOperation(operation, MFA_VERIFICATION_MESSAGE);
            }
            if (!isCurrentMfaOperation(operation)) return null;
            const challengeId = challenge?.data?.id;
            if (challenge?.error || typeof challengeId !== 'string' || !challengeId.trim()) return failMfaOperation(operation, MFA_VERIFICATION_MESSAGE);

            let verified;
            try {
                verified = await client.auth.mfa.verify({ factorId, challengeId, code });
            } catch {
                return failMfaOperation(operation, MFA_VERIFICATION_MESSAGE);
            }
            if (!isCurrentMfaOperation(operation)) return null;

            const nextSession = verified?.data;
            if (verified?.error || !authSessionKey(nextSession) || nextSession.user?.id !== operation.userId) return failMfaOperation(operation, MFA_VERIFICATION_MESSAGE);

            if (clearEnrollment) mfaEnrollment.value = null;
            rejectedAuthSessions.delete(authSessionKey(nextSession));
            trackIdentity(nextSession);
            await awaitIdentitySettled();
            if (user.value?.id !== operation.userId) return null;
            return refreshMfaState();
        } finally {
            endMfaLoading(loadingTicket);
        }
    };

    const verifyTotpEnrollment = (code) =>
        runMfaMutation(() => {
            const enrollment = mfaEnrollment.value;
            if (!enrollment?.factorId || enrollment.cleanupPending) {
                error.value = MFA_ENROLLMENT_MESSAGE;
                throw rejection(MFA_ENROLLMENT_MESSAGE);
            }
            return verifyTotpFactor(enrollment.factorId, code, true);
        });

    const verifyTotpChallenge = (factorId, code) => runMfaMutation(() => verifyTotpFactor(factorId, code, false));

    const cancelTotpEnrollment = () =>
        runMfaMutation(async () => {
            requireMfaIdentity();
            const enrollment = mfaEnrollment.value;
            if (!enrollment?.factorId) return null;

            const operation = startMfaOperation();
            const cleanupHandle = { factorId: enrollment.factorId, cleanupPending: true };
            mfaEnrollment.value = null;
            const loadingTicket = beginMfaLoading(operation);
            try {
                let result;
                try {
                    result = await client.auth.mfa.unenroll({ factorId: enrollment.factorId });
                } catch {
                    if (isCurrentMfaOperation(operation)) mfaEnrollment.value = cleanupHandle;
                    return failMfaOperation(operation, MFA_CANCELLATION_MESSAGE, 'error');
                }
                if (!isCurrentMfaOperation(operation)) return null;
                if (result?.error) {
                    mfaEnrollment.value = cleanupHandle;
                    return failMfaOperation(operation, MFA_CANCELLATION_MESSAGE, 'error');
                }
                return refreshMfaState();
            } finally {
                endMfaLoading(loadingTicket);
            }
        });

    const unenrollTotp = (factorId) =>
        runMfaMutation(async () => {
            requireMfaIdentity();
            const operation = startMfaOperation();
            const loadingTicket = beginMfaLoading(operation);
            try {
                await withTotpFactorLock(operation, async () => {
                    let authoritativeFactors;
                    try {
                        authoritativeFactors = await client.auth.mfa.listFactors();
                    } catch {
                        return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
                    }
                    if (!isCurrentMfaOperation(operation)) return null;
                    if (authoritativeFactors?.error || !authoritativeFactors?.data) return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');

                    const factors = verifiedTotpFactors(authoritativeFactors);
                    mfaFactors.value = factors;
                    if (!factors.some((factor) => factor.id === factorId)) return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE);
                    if (factors.length <= 1) return failMfaOperation(operation, MFA_LAST_FACTOR_MESSAGE);

                    let result;
                    try {
                        result = await client.auth.mfa.unenroll({ factorId });
                    } catch {
                        return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
                    }
                    if (!isCurrentMfaOperation(operation)) return null;
                    if (result?.error) return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
                });
                if (!isCurrentMfaOperation(operation)) return null;

                let refreshed;
                try {
                    refreshed = await client.auth.refreshSession();
                } catch {
                    return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
                }
                if (!isCurrentMfaOperation(operation)) return null;
                const nextSession = refreshed?.data?.session;
                if (refreshed?.error || !authSessionKey(nextSession) || nextSession.user?.id !== operation.userId) {
                    return failMfaOperation(operation, MFA_UNENROLLMENT_MESSAGE, 'error');
                }

                rejectedAuthSessions.delete(authSessionKey(nextSession));
                trackIdentity(nextSession);
                await awaitIdentitySettled();
                if (user.value?.id !== operation.userId) return null;
                return refreshMfaState();
            } finally {
                endMfaLoading(loadingTicket);
            }
        });

    const subscribe = () => {
        if (subscription || !isConfigured) return;

        const result = client.auth.onAuthStateChange((event, nextSession) => {
            if (event === 'INITIAL_SESSION') return;
            if (isRejectedSession(nextSession)) return;
            if (hydratingStoredSession) {
                bufferedInitialAuth = { session: nextSession };
                return;
            }
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
                hydratingStoredSession = true;
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
                if (identityVersion !== startingVersion) return;

                const storedSession = data?.session || null;
                const initialAuth = bufferedInitialAuth;
                bufferedInitialAuth = null;
                const bufferedSession = initialAuth?.session || null;
                if (initialAuth && !isSameAuthSession(bufferedSession, storedSession)) {
                    hydratingStoredSession = false;
                    trackIdentity(bufferedSession);
                    return;
                }

                const nextSession = initialAuth ? bufferedSession : storedSession;
                if (nextSession) {
                    if (isRejectedSession(nextSession)) {
                        error.value = '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.';
                        return;
                    }
                    let verified;
                    try {
                        verified = await client.auth.getUser(nextSession.access_token);
                    } catch (cause) {
                        const latestAuth = bufferedInitialAuth;
                        bufferedInitialAuth = null;
                        hydratingStoredSession = false;
                        if (latestAuth && !isSameAuthSession(latestAuth.session, nextSession)) {
                            trackIdentity(latestAuth.session || null);
                            return;
                        }
                        error.value = normalizedError(cause, '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                        return;
                    }
                    const verifiedUser = verified?.data?.user;
                    const verificationFailedTransiently = verified?.error && !isInvalidSessionError(verified.error);
                    const invalidStoredSession =
                        !verificationFailedTransiently && (verified?.error || !verifiedUser || verifiedUser.id !== nextSession.user?.id);
                    const rejectedKey = invalidStoredSession && authSessionKey(nextSession);
                    const explicitlyReauthenticated = identityVersion !== startingVersion && authSessionKey(session.value) === rejectedKey;
                    if (rejectedKey && !explicitlyReauthenticated) rejectedAuthSessions.add(rejectedKey);
                    if (identityVersion !== startingVersion) return;
                    const latestAuth = bufferedInitialAuth;
                    bufferedInitialAuth = null;
                    if (latestAuth && !isSameAuthSession(latestAuth.session, nextSession)) {
                        hydratingStoredSession = false;
                        trackIdentity(latestAuth.session || null);
                        return;
                    }
                    if (verificationFailedTransiently) {
                        hydratingStoredSession = false;
                        error.value = normalizedError(verified.error, '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                        return;
                    }
                    if (invalidStoredSession) {
                        hydratingStoredSession = false;
                        clearIdentity();
                        error.value = '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.';
                        return;
                    }
                    hydratingStoredSession = false;
                    trackIdentity({ ...nextSession, user: verifiedUser });
                } else {
                    hydratingStoredSession = false;
                    trackIdentity(null);
                }
            } finally {
                hydratingStoredSession = false;
                bufferedInitialAuth = null;
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

            const signedInSession = data?.session || null;
            if (!authSessionKey(signedInSession)) {
                const message = '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
                error.value = message;
                throw rejection(message);
            }
            if (identityVersion === startingVersion) {
                rejectedAuthSessions.delete(authSessionKey(signedInSession));
                trackIdentity(signedInSession);
            }
            await awaitIdentitySettled();

            return { session: session.value, user: user.value };
        } finally {
            endOperation();
        }
    };

    const changePassword = async (currentPassword, newPassword) => {
        const fail = (message) => {
            error.value = message;
            throw rejection(message);
        };

        if (!isConfigured) fail(NOT_CONFIGURED_MESSAGE);
        if (!session.value || !user.value?.id || !user.value?.email?.trim() || session.value.user?.id !== user.value.id) {
            fail('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
        }
        if (!profile.value) fail(MISSING_PROFILE_MESSAGE);
        if (!profile.value.is_active) fail(INACTIVE_PROFILE_MESSAGE);
        if (typeof currentPassword !== 'string' || !currentPassword.trim()) fail('현재 비밀번호를 입력해 주세요.');
        if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128 || !newPassword.trim()) {
            fail('새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.');
        }
        if (currentPassword === newPassword) fail('새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.');

        const currentUserId = user.value.id;
        const email = user.value.email.trim();
        beginOperation();
        error.value = null;
        try {
            let reauthenticated;
            try {
                reauthenticated = await client.auth.signInWithPassword({ email, password: currentPassword });
            } catch {
                fail('현재 비밀번호가 올바르지 않습니다.');
            }
            if (reauthenticated?.error) fail('현재 비밀번호가 올바르지 않습니다.');
            if (reauthenticated?.data?.user?.id !== currentUserId) fail('로그인 상태가 변경되었습니다. 다시 로그인해 주세요.');

            let updated;
            try {
                updated = await client.auth.updateUser({ password: newPassword });
            } catch (cause) {
                fail(normalizedError(cause, '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
            }
            if (updated?.error) fail(normalizedError(updated.error, '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
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
        mfaStatus,
        mfaFactors,
        mfaEnrollment,
        mfaSatisfied,
        initialize,
        waitForIdentity,
        refreshMfaState,
        beginTotpEnrollment,
        verifyTotpEnrollment,
        verifyTotpChallenge,
        cancelTotpEnrollment,
        unenrollTotp,
        signIn,
        changePassword,
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
