import { describe, expect, it, vi } from 'vitest';
import { createWorkerApp } from './app';

const callerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId = '11111111-1111-4111-8111-111111111111';
const accountColumns = 'id, email, display_name, department, role, is_active, created_at, updated_at';

const accountRow = {
    id: accountId,
    email: 'employee@example.com',
    display_name: '김서준',
    department: '영업팀',
    role: 'approver',
    is_active: true,
    created_at: '2026-09-12T01:00:00.000Z',
    updated_at: '2026-09-12T02:00:00.000Z',
    private_note: 'must-not-leak',
    encrypted_password: 'must-not-leak'
};

const publicAccount = {
    id: accountId,
    email: 'employee@example.com',
    displayName: '김서준',
    department: '영업팀',
    role: 'approver',
    isActive: true,
    createdAt: '2026-09-12T01:00:00.000Z',
    updatedAt: '2026-09-12T02:00:00.000Z'
};

function createUserClientFixture({
    events = [],
    user = { id: callerId, email: 'admin@example.com' },
    authError = null,
    authThrows = null,
    profile = { id: callerId, role: 'admin', is_active: true },
    profileError = null,
    profileThrows = null,
    accounts = [accountRow],
    accountsError = null,
    accountsThrows = null,
    rpcData = accountRow,
    rpcError = null,
    rpcThrows = null
} = {}) {
    const getUser = vi.fn(async () => {
        events.push('get-user');
        if (authThrows) throw authThrows;
        return { data: { user }, error: authError };
    });
    const maybeSingle = vi.fn(async () => {
        events.push('get-profile');
        if (profileThrows) throw profileThrows;
        return { data: profile, error: profileError };
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(async () => {
        events.push('list-accounts');
        if (accountsThrows) throw accountsThrows;
        return { data: accounts, error: accountsError };
    });
    const select = vi.fn((columns) => {
        if (columns === 'id, role, is_active') return { eq };
        if (columns === accountColumns) return { order };
        throw new Error(`Unexpected profile selection: ${columns}`);
    });
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn(async () => {
        events.push('update-profile');
        if (rpcThrows) throw rpcThrows;
        return { data: rpcData, error: rpcError };
    });

    return { client: { auth: { getUser }, from, rpc }, getUser, from, select, eq, maybeSingle, order, rpc };
}

function createAdminClientFixture({
    events = [],
    createdUser = { id: accountId, email: accountRow.email },
    createError = null,
    createThrows = null,
    deleteError = null,
    deleteThrows = null,
    updateError = null,
    updateThrows = null
} = {}) {
    const createUser = vi.fn(async () => {
        events.push('create-user');
        if (createThrows) throw createThrows;
        return { data: { user: createdUser }, error: createError };
    });
    const deleteUser = vi.fn(async () => {
        events.push('delete-user');
        if (deleteThrows) throw deleteThrows;
        return { data: {}, error: deleteError };
    });
    const updateUserById = vi.fn(async () => {
        events.push('reset-password');
        if (updateThrows) throw updateThrows;
        return { data: { user: { id: accountId, email: accountRow.email } }, error: updateError };
    });

    return { client: { auth: { admin: { createUser, deleteUser, updateUserById } } }, createUser, deleteUser, updateUserById };
}

function createApp({ userFixture = createUserClientFixture(), adminFixture = createAdminClientFixture(), events = [] } = {}) {
    const createSupabaseClient = vi.fn(() => userFixture.client);
    const createAdminClient = vi.fn(() => {
        events.push('create-admin-client');
        return adminFixture.client;
    });
    return { app: createWorkerApp({ createSupabaseClient, createAdminClient }), createSupabaseClient, createAdminClient, userFixture, adminFixture };
}

function request(path, { method = 'GET', body, token = 'session-token' } = {}) {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    return new Request(`https://erp.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
}

const validCreateBody = {
    email: ' New.Employee@Example.com ',
    temporaryPassword: 'Temporary-Password-1!',
    displayName: ' 새 직원 ',
    department: ' 운영팀 ',
    role: 'user'
};

const validPatchBody = {
    displayName: ' 변경된 이름 ',
    department: ' 재무팀 ',
    role: 'approver',
    isActive: false
};

const validPasswordBody = {
    temporaryPassword: 'Replacement-Password-2!'
};

describe('administrator account API', () => {
    it.each([
        ['GET', '/api/admin/accounts'],
        ['POST', '/api/admin/accounts'],
        ['PATCH', `/api/admin/accounts/${accountId}`],
        ['POST', `/api/admin/accounts/${accountId}/password`]
    ])('requires a bearer token before handling %s %s', async (method, path) => {
        const { app, createSupabaseClient, createAdminClient } = createApp();
        const response = await app.fetch(request(path, { method, token: null }), {});

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: { code: 'missing_authorization', message: '인증 정보가 필요합니다.' } });
        expect(createSupabaseClient).not.toHaveBeenCalled();
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('rejects an invalid session without exposing provider details', async () => {
        const userFixture = createUserClientFixture({ user: null, authError: { code: 'bad_jwt', status: 401, message: 'raw rejected token detail' } });
        const { app, createAdminClient } = createApp({ userFixture });
        const response = await app.fetch(request('/api/admin/accounts'), {});
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: { code: 'invalid_session', message: '유효하지 않은 로그인 세션입니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw rejected token detail');
        expect(JSON.stringify(body)).not.toContain('session-token');
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        ['inactive caller', { id: callerId, role: 'admin', is_active: false }, 'inactive_user', '비활성화된 사용자입니다.'],
        ['non-admin caller', { id: callerId, role: 'user', is_active: true }, 'admin_required', '관리자 권한이 필요합니다.']
    ])('forbids an %s before constructing the secret client', async (_label, profile, code, message) => {
        const events = [];
        const userFixture = createUserClientFixture({ events, profile });
        const { app, createAdminClient } = createApp({ userFixture, events });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code, message } });
        expect(events).toEqual(['get-user', 'get-profile']);
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('lists accounts using the caller-scoped client and returns only whitelisted fields', async () => {
        const userFixture = createUserClientFixture({ accounts: [{ ...accountRow, access_token: 'must-not-leak' }] });
        const { app, createAdminClient } = createApp({ userFixture });
        const response = await app.fetch(request('/api/admin/accounts'), {});

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ accounts: [publicAccount] });
        expect(userFixture.select).toHaveBeenCalledWith(accountColumns);
        expect(userFixture.order).toHaveBeenCalledWith('created_at', { ascending: false });
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{', 'invalid_request', '요청 내용을 확인해 주세요.'],
        ['invalid email', { ...validCreateBody, email: 'not-an-email' }, 'invalid_email', '올바른 이메일 주소를 입력해 주세요.'],
        ['short password', { ...validCreateBody, temporaryPassword: 'short' }, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.'],
        ['blank name', { ...validCreateBody, displayName: '   ' }, 'invalid_display_name', '이름을 입력해 주세요.'],
        ['blank department', { ...validCreateBody, department: '   ' }, 'invalid_department', '부서를 입력해 주세요.'],
        ['administrator creation', { ...validCreateBody, role: 'admin' }, 'invalid_role', '생성할 계정의 권한을 확인해 주세요.']
    ])('validates create payloads: %s', async (_label, body, code, message) => {
        const { app, createAdminClient } = createApp();
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body }), {});

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: { code, message } });
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('returns a stable service error when the server-only secret is missing', async () => {
        const userFixture = createUserClientFixture();
        const createSupabaseClient = vi.fn(() => userFixture.client);
        const app = createWorkerApp({ createSupabaseClient });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {
            SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        });
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body).toEqual({ error: { code: 'service_unavailable', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('project.supabase.co');
        expect(JSON.stringify(body)).not.toContain('publishable-key');
    });

    it('creates an email-confirmed user after authorization and updates its profile through the protected RPC', async () => {
        const events = [];
        const userFixture = createUserClientFixture({ events });
        const adminFixture = createAdminClientFixture({ events });
        const { app, createAdminClient } = createApp({ userFixture, adminFixture, events });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ account: publicAccount });
        expect(events).toEqual(['get-user', 'get-profile', 'create-admin-client', 'create-user', 'update-profile']);
        expect(createAdminClient).toHaveBeenCalledOnce();
        expect(adminFixture.createUser).toHaveBeenCalledWith({
            email: 'new.employee@example.com',
            password: 'Temporary-Password-1!',
            email_confirm: true
        });
        expect(userFixture.rpc).toHaveBeenCalledWith('admin_update_profile', {
            target_id: accountId,
            new_display_name: '새 직원',
            new_department: '운영팀',
            new_role: 'user',
            new_is_active: true
        });
        expect(adminFixture.deleteUser).not.toHaveBeenCalled();
    });

    it.each([[{ code: 'email_exists', status: 422, message: 'raw duplicate detail' }], [{ code: 'user_already_exists', status: 422, message: 'raw duplicate provider detail' }]])(
        'maps duplicate email failures to a redacted conflict',
        async (createError) => {
            const adminFixture = createAdminClientFixture({ createError });
            const { app } = createApp({ adminFixture });
            const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});
            const body = await response.json();

            expect(response.status).toBe(409);
            expect(body).toEqual({ error: { code: 'email_exists', message: '이미 사용 중인 이메일입니다.' } });
            expect(JSON.stringify(body)).not.toContain(createError.message);
        }
    );

    it.each([
        ['returned provider failure', { createError: { code: 'unexpected_failure', status: 503, message: 'raw create provider detail' } }],
        ['thrown provider failure', { createThrows: new Error('raw create transport detail') }]
    ])('redacts an upstream Auth user creation failure: %s', async (_label, adminOptions) => {
        const adminFixture = createAdminClientFixture(adminOptions);
        const { app } = createApp({ adminFixture });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw create');
        expect(JSON.stringify(body)).not.toContain(validCreateBody.temporaryPassword);
    });

    it('deletes the newly created Auth user when the protected profile update fails', async () => {
        const events = [];
        const userFixture = createUserClientFixture({ events, rpcError: { code: 'XX000', message: 'raw database detail' } });
        const adminFixture = createAdminClientFixture({ events });
        const { app } = createApp({ userFixture, adminFixture, events });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(events).toEqual(['get-user', 'get-profile', 'create-admin-client', 'create-user', 'update-profile', 'delete-user']);
        expect(adminFixture.deleteUser).toHaveBeenCalledWith(accountId);
        expect(JSON.stringify(body)).not.toContain('raw database detail');
        expect(JSON.stringify(body)).not.toContain(validCreateBody.temporaryPassword);
    });

    it('keeps the response stable when compensation deletion also fails', async () => {
        const userFixture = createUserClientFixture({ rpcThrows: new Error('raw rpc transport detail') });
        const adminFixture = createAdminClientFixture({ deleteThrows: new Error('raw compensation detail') });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { app } = createApp({ userFixture, adminFixture });
        const response = await app.fetch(request('/api/admin/accounts', { method: 'POST', body: validCreateBody }), {});
        const serialized = JSON.stringify(await response.json());

        expect(response.status).toBe(502);
        expect(serialized).not.toContain('raw rpc transport detail');
        expect(serialized).not.toContain('raw compensation detail');
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it.each([
        ['invalid account id', '/api/admin/accounts/not-a-uuid', validPatchBody, 'invalid_account_id', '올바른 계정 ID가 아닙니다.'],
        ['blank display name', `/api/admin/accounts/${accountId}`, { ...validPatchBody, displayName: '   ' }, 'invalid_display_name', '이름을 입력해 주세요.'],
        ['invalid role', `/api/admin/accounts/${accountId}`, { ...validPatchBody, role: 'owner' }, 'invalid_role', '계정 권한을 확인해 주세요.'],
        ['invalid activation', `/api/admin/accounts/${accountId}`, { ...validPatchBody, isActive: 'yes' }, 'invalid_activation', '계정 활성화 상태를 확인해 주세요.']
    ])('validates update payloads: %s', async (_label, path, body, code, message) => {
        const { app } = createApp();
        const response = await app.fetch(request(path, { method: 'PATCH', body }), {});

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: { code, message } });
    });

    it('updates an account only through the caller-scoped protected RPC', async () => {
        const userFixture = createUserClientFixture();
        const { app, createAdminClient } = createApp({ userFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}`, { method: 'PATCH', body: validPatchBody }), {});

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ account: publicAccount });
        expect(userFixture.rpc).toHaveBeenCalledWith('admin_update_profile', {
            target_id: accountId,
            new_display_name: '변경된 이름',
            new_department: '재무팀',
            new_role: 'approver',
            new_is_active: false
        });
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid account id', '/api/admin/accounts/not-a-uuid/password', validPasswordBody, 'invalid_account_id', '올바른 계정 ID가 아닙니다.'],
        ['malformed JSON', `/api/admin/accounts/${accountId}/password`, '{', 'invalid_request', '요청 내용을 확인해 주세요.'],
        ['missing password', `/api/admin/accounts/${accountId}/password`, {}, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.'],
        ['short password', `/api/admin/accounts/${accountId}/password`, { temporaryPassword: 'short' }, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.'],
        ['whitespace password', `/api/admin/accounts/${accountId}/password`, { temporaryPassword: '        ' }, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.'],
        ['long password', `/api/admin/accounts/${accountId}/password`, { temporaryPassword: 'x'.repeat(129) }, 'invalid_temporary_password', '임시 비밀번호는 8자 이상이어야 합니다.']
    ])('validates password reset payloads: %s', async (_label, path, body, code, message) => {
        const { app, createAdminClient } = createApp();
        const response = await app.fetch(request(path, { method: 'POST', body }), {});

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: { code, message } });
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('resets the password only after active administrator authorization and returns no content', async () => {
        const events = [];
        const userFixture = createUserClientFixture({ events });
        const adminFixture = createAdminClientFixture({ events });
        const { app, createAdminClient } = createApp({ userFixture, adminFixture, events });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: validPasswordBody }), {});

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(events).toEqual(['get-user', 'get-profile', 'create-admin-client', 'reset-password']);
        expect(createAdminClient).toHaveBeenCalledOnce();
        expect(adminFixture.updateUserById).toHaveBeenCalledWith(accountId, { password: validPasswordBody.temporaryPassword });
    });

    it('returns a stable service error when password reset secret configuration is missing', async () => {
        const userFixture = createUserClientFixture();
        const createSupabaseClient = vi.fn(() => userFixture.client);
        const createAdminClient = vi.fn(() => {
            const error = new Error('server-role-key-missing');
            error.code = 'worker_configuration_error';
            throw error;
        });
        const app = createWorkerApp({ createSupabaseClient, createAdminClient });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: validPasswordBody }), {});
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body).toEqual({ error: { code: 'service_unavailable', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('server-role-key-missing');
        expect(JSON.stringify(body)).not.toContain(validPasswordBody.temporaryPassword);
        expect(JSON.stringify(body)).not.toContain('session-token');
    });

    it('maps an unknown Auth user to a stable account-not-found response', async () => {
        const adminFixture = createAdminClientFixture({ updateError: { code: 'user_not_found', status: 404, message: 'raw missing user detail' } });
        const { app } = createApp({ adminFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: validPasswordBody }), {});
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body).toEqual({ error: { code: 'account_not_found', message: '계정을 찾을 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw missing user detail');
        expect(JSON.stringify(body)).not.toContain(validPasswordBody.temporaryPassword);
    });

    it.each([
        ['returned provider failure', { updateError: { code: 'unexpected_failure', status: 503, message: 'raw reset provider detail' } }],
        ['thrown transport failure', { updateThrows: new Error('raw reset transport detail') }]
    ])('redacts password reset failures and does not log them: %s', async (_label, adminOptions) => {
        const adminFixture = createAdminClientFixture(adminOptions);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { app } = createApp({ adminFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: validPasswordBody }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw reset');
        expect(JSON.stringify(body)).not.toContain(validPasswordBody.temporaryPassword);
        expect(JSON.stringify(body)).not.toContain('session-token');
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it.each([
        ['self demotion', { code: '22023', message: 'self_demotion_forbidden', details: 'raw self demotion detail' }, 'self_demotion_forbidden', '현재 관리자 계정의 권한은 변경할 수 없습니다.'],
        ['self deactivation', { code: '22023', message: 'self_deactivation_forbidden', details: 'raw self deactivation detail' }, 'self_deactivation_forbidden', '현재 관리자 계정은 비활성화할 수 없습니다.'],
        ['missing account', { code: 'P0002', message: 'profile_not_found', details: 'raw missing profile detail' }, 'account_not_found', '계정을 찾을 수 없습니다.']
    ])('maps %s RPC rejections to stable validation responses', async (_label, rpcError, code, message) => {
        const userFixture = createUserClientFixture({ rpcData: null, rpcError });
        const { app } = createApp({ userFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}`, { method: 'PATCH', body: validPatchBody }), {});
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ error: { code, message } });
        expect(JSON.stringify(body)).not.toContain(rpcError.details);
    });

    it.each([
        ['authentication transport', { authThrows: new Error('raw auth transport detail') }, '/api/admin/accounts', 'GET'],
        ['authorization profile query', { profileError: { message: 'raw profile query detail' } }, '/api/admin/accounts', 'GET'],
        ['account list query', { accountsError: { message: 'raw account list detail' } }, '/api/admin/accounts', 'GET'],
        ['account update RPC', { rpcError: { message: 'raw account RPC detail' }, rpcData: null }, `/api/admin/accounts/${accountId}`, 'PATCH']
    ])('redacts upstream failures from %s', async (_label, fixtureOptions, path, method) => {
        const userFixture = createUserClientFixture(fixtureOptions);
        const { app } = createApp({ userFixture });
        const response = await app.fetch(request(path, { method, body: method === 'PATCH' ? validPatchBody : undefined }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw ');
    });
});
