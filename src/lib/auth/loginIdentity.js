export const LOGIN_ID_PATTERN = /^[a-z0-9]{4,20}$/;

export const isValidLoginId = (value) => typeof value === 'string' && LOGIN_ID_PATTERN.test(value);

export const loginIdToInternalEmail = (value) => (isValidLoginId(value) ? `${value}@nexerp.internal` : null);

export const internalEmailToLoginId = (value) => {
    if (typeof value !== 'string') return null;
    const normalizedEmail = value.trim().toLowerCase();
    const suffix = '@nexerp.internal';
    if (!normalizedEmail.endsWith(suffix)) return null;
    const loginId = normalizedEmail.slice(0, -suffix.length);
    return loginIdToInternalEmail(loginId) === normalizedEmail ? loginId : null;
};
