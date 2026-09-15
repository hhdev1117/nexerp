export function getBackupCapability() {
    return Object.freeze({ enabled: false, provider: 'r2', destructiveCleanup: false });
}
