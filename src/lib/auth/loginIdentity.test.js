import { describe, expect, it } from 'vitest';
import { isValidLoginId, loginIdToInternalEmail } from './loginIdentity';

describe('login identity', () => {
    it.each(['admin01', '1234', 'a1b2'])('accepts %s', (value) => expect(isValidLoginId(value)).toBe(true));
    it.each(['abc', 'Admin01', 'admin_01', '관리자1', 'admin 01', 'a'.repeat(21)])('rejects %s', (value) => expect(isValidLoginId(value)).toBe(false));
    it('maps a valid ID to the internal auth address', () => expect(loginIdToInternalEmail('admin01')).toBe('admin01@nexerp.internal'));
    it('does not normalize invalid input', () => expect(loginIdToInternalEmail('Admin01')).toBeNull());
});
