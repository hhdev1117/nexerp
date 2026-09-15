import { describe, expect, it } from 'vitest';
import * as capabilityModule from './capability';

describe('backup capability', () => {
    it('exposes only an immutable disabled R2 capability', () => {
        const capability = capabilityModule.getBackupCapability();

        expect(capability).toEqual({ enabled: false, provider: 'r2', destructiveCleanup: false });
        expect(Object.isFrozen(capability)).toBe(true);
        expect(() => {
            capability.enabled = true;
        }).toThrow(TypeError);
        expect(Object.keys(capabilityModule)).toEqual(['getBackupCapability']);
        expect(Object.keys(capability)).toEqual(['enabled', 'provider', 'destructiveCleanup']);
    });
});
