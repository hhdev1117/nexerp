import { describe, expect, it } from 'vitest';
import { internalEmailToLoginId, isValidLoginId, loginIdToInternalEmail } from './loginIdentity';

describe('login identity', () => {
    it('accepts only lowercase alphanumeric IDs between 4 and 20 characters', () => {
        expect(isValidLoginId('user1234')).toBe(true);
        expect(isValidLoginId('ABC1')).toBe(false);
        expect(isValidLoginId('abc')).toBe(false);
        expect(isValidLoginId('user-name')).toBe(false);
    });

    it('maps login IDs to private internal emails and back', () => {
        expect(loginIdToInternalEmail('user1234')).toBe('user1234@nexerp.internal');
        expect(internalEmailToLoginId('USER1234@NEXERP.INTERNAL')).toBe('user1234');
        expect(internalEmailToLoginId('user@example.com')).toBeNull();
    });
});
