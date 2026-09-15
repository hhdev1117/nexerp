export const LOGIN_ID_PATTERN = /^[a-z0-9]{4,20}$/;
export const isValidLoginId = (value) => typeof value === 'string' && LOGIN_ID_PATTERN.test(value);
export const loginIdToInternalEmail = (value) => (isValidLoginId(value) ? `${value}@nexerp.internal` : null);
