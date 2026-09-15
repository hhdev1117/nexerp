import { describe, expect, it, vi } from 'vitest';
import { bootstrapAdmin, normalizeBootstrapErrorCode, runBootstrapCli } from './bootstrap-admin.mjs';

const temporaryPassword = ['temporary', 'password'].join('-');

const createFixture = ({ createError = null, promotionError = null, deleteError = null, deleteThrows = null } = {}) => {
    const createUser = vi.fn().mockResolvedValue({
        data: createError ? null : { user: { id: 'new-user-id' } },
        error: createError
    });
    const deleteUser = vi.fn(() => {
        if (deleteThrows) throw deleteThrows;
        return Promise.resolve({ data: deleteError ? null : {}, error: deleteError });
    });
    const rpc = vi.fn().mockResolvedValue({ data: promotionError ? null : 'new-user-id', error: promotionError });
    const client = { rpc, auth: { admin: { createUser, deleteUser } } };

    return { client, createUser, deleteUser, rpc };
};

describe('bootstrapAdmin', () => {
    it.each(['abc', 'Admin01', 'admin-01', ' admin01'])('rejects invalid login ID %j before provider access', async (loginId) => {
        const fixture = createFixture();

        await expect(bootstrapAdmin({ loginId, temporaryPassword, client: fixture.client })).rejects.toThrow('invalid_login_id');
        expect(fixture.createUser).not.toHaveBeenCalled();
    });

    it('compensates the new Auth user when the locked bootstrap RPC finds an active administrator', async () => {
        const fixture = createFixture({ promotionError: { message: 'active_admin_exists' } });

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client })).rejects.toThrow('active_admin_exists');
        expect(fixture.createUser).toHaveBeenCalledOnce();
        expect(fixture.rpc).toHaveBeenCalledWith('bootstrap_first_admin', { target_user_id: 'new-user-id' });
        expect(fixture.deleteUser).toHaveBeenCalledWith('new-user-id');
    });

    it('creates the internal Auth identity with provisioning metadata and promotes its exact profile', async () => {
        const fixture = createFixture();
        const logger = { info: vi.fn(), error: vi.fn() };

        await bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client, logger });

        expect(fixture.createUser).toHaveBeenCalledWith({
            email: 'admin01@nexerp.internal',
            password: temporaryPassword,
            email_confirm: true,
            app_metadata: { nexerp_provisioned: true, login_id: 'admin01' }
        });
        expect(fixture.rpc).toHaveBeenCalledWith('bootstrap_first_admin', { target_user_id: 'new-user-id' });
        expect(logger.info).toHaveBeenCalledWith('Administrator admin01 created.');
    });

    it('deletes the newly created Auth user when profile promotion fails', async () => {
        const fixture = createFixture({ promotionError: { message: 'promotion failed' } });

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client })).rejects.toThrow('profile_promotion_failed');
        expect(fixture.deleteUser).toHaveBeenCalledWith('new-user-id');
    });

    it.each([
        ['resolved deletion error', { deleteError: { message: 'delete rejected' } }],
        ['thrown deletion failure', { deleteThrows: new Error('delete unavailable') }]
    ])('surfaces a stable compensation-failure code for %s', async (_case, deletionFailure) => {
        const fixture = createFixture({ promotionError: { message: 'promotion failed' }, ...deletionFailure });

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client })).rejects.toThrow(
            'promotion_failed_compensation_failed'
        );
    });

    it('never writes the temporary password to logs when creation fails', async () => {
        const fixture = createFixture({ createError: { message: `rejected ${temporaryPassword}` } });
        const logger = { info: vi.fn(), error: vi.fn() };

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client, logger })).rejects.toThrow('auth_user_creation_failed');

        const logged = [...logger.info.mock.calls, ...logger.error.mock.calls].flat().join(' ');
        expect(logged).not.toContain(temporaryPassword);
    });
});

describe('runBootstrapCli', () => {
    it.each(['short', 'x'.repeat(129)])('rejects temporary passwords outside 8-128 characters with a stable code', async (password) => {
        const createClient = vi.fn();

        await expect(
            runBootstrapCli({
                env: {
                    SUPABASE_URL: 'https://project.supabase.co',
                    SUPABASE_SECRET_KEY: 'server-secret',
                    NEXERP_ADMIN_LOGIN_ID: 'admin01',
                    NEXERP_ADMIN_TEMPORARY_PASSWORD: password
                },
                createClient
            })
        ).rejects.toThrow('invalid_temporary_password');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('rejects missing server configuration with a stable code before client creation', async () => {
        const createClient = vi.fn();

        await expect(
            runBootstrapCli({ env: { NEXERP_ADMIN_LOGIN_ID: 'admin01', NEXERP_ADMIN_TEMPORARY_PASSWORD: temporaryPassword }, createClient })
        ).rejects.toThrow('missing_configuration');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('normalizes unexpected provider errors without exposing their message', () => {
        expect(normalizeBootstrapErrorCode(new Error(`provider rejected ${temporaryPassword}`))).toBe('bootstrap_failed');
        expect(normalizeBootstrapErrorCode(new Error('active_admin_exists'))).toBe('active_admin_exists');
        expect(normalizeBootstrapErrorCode(new Error('promotion_failed_compensation_failed'))).toBe('promotion_failed_compensation_failed');
    });
});
