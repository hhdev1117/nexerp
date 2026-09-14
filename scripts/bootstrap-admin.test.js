import { describe, expect, it, vi } from 'vitest';
import { bootstrapAdmin, normalizeBootstrapErrorCode, runBootstrapCli } from './bootstrap-admin.mjs';

const temporaryPassword = ['temporary', 'password'].join('-');

const createFixture = ({ activeAdmins = [], createError = null, promotionError = null } = {}) => {
    const limit = vi.fn().mockResolvedValue({ data: activeAdmins, error: null });
    const active = vi.fn(() => ({ limit }));
    const role = vi.fn(() => ({ eq: active }));
    const select = vi.fn(() => ({ eq: role }));

    const single = vi.fn().mockResolvedValue({
        data: promotionError ? null : { id: 'new-user-id' },
        error: promotionError
    });
    const selectPromoted = vi.fn(() => ({ single }));
    const id = vi.fn(() => ({ select: selectPromoted }));
    const update = vi.fn(() => ({ eq: id }));

    const from = vi.fn(() => ({ select, update }));
    const createUser = vi.fn().mockResolvedValue({
        data: createError ? null : { user: { id: 'new-user-id' } },
        error: createError
    });
    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = { from, auth: { admin: { createUser, deleteUser } } };

    return { client, createUser, deleteUser, update, id };
};

describe('bootstrapAdmin', () => {
    it.each(['abc', 'Admin01', 'admin-01', ' admin01'])('rejects invalid login ID %j before provider access', async (loginId) => {
        const fixture = createFixture();

        await expect(bootstrapAdmin({ loginId, temporaryPassword, client: fixture.client })).rejects.toThrow('invalid_login_id');
        expect(fixture.client.from).not.toHaveBeenCalled();
    });

    it('refuses bootstrap before creating a user when an active administrator exists', async () => {
        const fixture = createFixture({ activeAdmins: [{ id: 'existing-admin-id' }] });

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client })).rejects.toThrow('active_admin_exists');
        expect(fixture.createUser).not.toHaveBeenCalled();
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
        expect(fixture.update).toHaveBeenCalledWith({ role: 'admin' });
        expect(fixture.id).toHaveBeenCalledWith('id', 'new-user-id');
        expect(logger.info).toHaveBeenCalledWith('Administrator admin01 created.');
    });

    it('deletes the newly created Auth user when profile promotion fails', async () => {
        const fixture = createFixture({ promotionError: { message: 'promotion failed' } });

        await expect(bootstrapAdmin({ loginId: 'admin01', temporaryPassword, client: fixture.client })).rejects.toThrow('profile_promotion_failed');
        expect(fixture.deleteUser).toHaveBeenCalledWith('new-user-id');
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
    });
});
