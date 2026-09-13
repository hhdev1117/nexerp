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
    aal = { currentLevel: 'aal2', nextLevel: 'aal2' },
    aalError = null,
    aalThrows = null,
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
    const getAuthenticatorAssuranceLevel = vi.fn(async () => {
        events.push('get-aal');
        if (aalThrows) throw aalThrows;
        return { data: aal, error: aalError };
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

    return { client: { auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } }, from, rpc }, getUser, getAuthenticatorAssuranceLevel, from, select, eq, maybeSingle, order, rpc };
}

function createAdminClientFixture({
    events = [],
    createdUser = { id: accountId, email: accountRow.email },
    createError = null,
    createThrows = null,
    deleteError = null,
    deleteThrows = null,
    updateError = null,
    updateThrows = null,
    updateResultFactory = null,
    factors = [],
    listFactorsError = null,
    listFactorsThrows = null,
    deleteFactorError = null,
    deleteFactorThrows = null,
    deleteFactorResultFactory = null
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
        if (updateResultFactory) return updateResultFactory();
        return { data: { user: { id: accountId, email: accountRow.email } }, error: updateError };
    });
    const listFactors = vi.fn(async () => {
        events.push('list-factors');
        if (listFactorsThrows) throw listFactorsThrows;
        return { data: { factors }, error: listFactorsError };
    });
    const deleteFactor = vi.fn(async ({ id, userId }) => {
        events.push(`delete-factor:${id}`);
        if (deleteFactorThrows) throw deleteFactorThrows;
        if (deleteFactorResultFactory) return deleteFactorResultFactory({ id, userId });
        return { data: { id, userId }, error: deleteFactorError };
    });

    return { client: { auth: { admin: { createUser, deleteUser, updateUserById, mfa: { listFactors, deleteFactor } } } }, createUser, deleteUser, updateUserById, listFactors, deleteFactor };
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
    email: ' New.Employee@GMAIL.com ',
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
        ['POST', `/api/admin/accounts/${accountId}/password`],
        ['POST', `/api/admin/accounts/${accountId}/mfa-reset`]
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
        expect(events).toEqual(['get-user', 'get-aal', 'get-profile']);
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
        ['invalid email', { ...validCreateBody, email: 'not-an-email' }, 'gmail_required', 'Gmail 주소만 사용할 수 있습니다.'],
        ['Gmail subdomain', { ...validCreateBody, email: 'staff@sub.gmail.com' }, 'gmail_required', 'Gmail 주소만 사용할 수 있습니다.'],
        ['Gmail suffix', { ...validCreateBody, email: 'staff@gmail.com.evil' }, 'gmail_required', 'Gmail 주소만 사용할 수 있습니다.'],
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
        expect(events).toEqual(['get-user', 'get-aal', 'get-profile', 'create-admin-client', 'create-user', 'update-profile']);
        expect(createAdminClient).toHaveBeenCalledOnce();
        expect(adminFixture.createUser).toHaveBeenCalledWith({
            email: 'new.employee@gmail.com',
            password: 'Temporary-Password-1!',
            email_confirm: true,
            app_metadata: { nexerp_provisioned: true }
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
        expect(events).toEqual(['get-user', 'get-aal', 'get-profile', 'create-admin-client', 'create-user', 'update-profile', 'delete-user']);
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
        ['AAL1', { currentLevel: 'aal1', nextLevel: 'aal2' }],
        ['missing assurance level', { currentLevel: null, nextLevel: 'aal2' }]
    ])('requires AAL2 before reading an administrator profile: %s', async (_label, aal) => {
        const events = [];
        const userFixture = createUserClientFixture({ events, aal });
        const { app, createAdminClient } = createApp({ userFixture, events });

        const response = await app.fetch(request('/api/admin/accounts'), {});

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code: 'mfa_required', message: '다중 인증을 완료한 후 다시 시도해 주세요.' } });
        expect(events).toEqual(['get-user', 'get-aal']);
        expect(userFixture.from).not.toHaveBeenCalled();
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('redacts administrator assurance lookup failures before profile access', async () => {
        const events = [];
        const userFixture = createUserClientFixture({ events, aalError: new Error('raw assurance provider detail') });
        const { app } = createApp({ userFixture, events });

        const response = await app.fetch(request('/api/admin/accounts'), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(events).toEqual(['get-user', 'get-aal']);
        expect(userFixture.from).not.toHaveBeenCalled();
        expect(JSON.stringify(body)).not.toContain('raw assurance provider detail');
    });

    it('redacts thrown administrator assurance lookup failures before profile access', async () => {
        const userFixture = createUserClientFixture({ aalThrows: new Error('raw assurance transport detail') });
        const { app } = createApp({ userFixture });

        const response = await app.fetch(request('/api/admin/accounts'), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(userFixture.from).not.toHaveBeenCalled();
        expect(JSON.stringify(body)).not.toContain('raw assurance transport detail');
    });

    it('updates only activation through the status-specific protected RPC', async () => {
        const userFixture = createUserClientFixture({
            rpcData: { ...accountRow, display_name: '최신 이름', department: '재무팀', role: 'admin', is_active: false }
        });
        const { app, createAdminClient } = createApp({ userFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}`, { method: 'PATCH', body: { isActive: false } }), {});

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            account: { ...publicAccount, displayName: '최신 이름', department: '재무팀', role: 'admin', isActive: false }
        });
        expect(userFixture.rpc).toHaveBeenCalledWith('admin_update_profile_status', {
            target_id: accountId,
            new_is_active: false
        });
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('keeps self-deactivation forbidden for status-only updates', async () => {
        const userFixture = createUserClientFixture({
            rpcData: null,
            rpcError: { code: '22023', message: 'self_deactivation_forbidden', details: 'raw self deactivation detail' }
        });
        const { app } = createApp({ userFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${callerId}`, { method: 'PATCH', body: { isActive: false } }), {});
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ error: { code: 'self_deactivation_forbidden', message: '현재 관리자 계정은 비활성화할 수 없습니다.' } });
        expect(userFixture.rpc).toHaveBeenCalledWith('admin_update_profile_status', {
            target_id: callerId,
            new_is_active: false
        });
        expect(JSON.stringify(body)).not.toContain('raw self deactivation detail');
    });

    it('keeps administrator authorization mandatory for status-only updates', async () => {
        const userFixture = createUserClientFixture({ profile: { id: callerId, role: 'user', is_active: true } });
        const { app } = createApp({ userFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}`, { method: 'PATCH', body: { isActive: false } }), {});

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code: 'admin_required', message: '관리자 권한이 필요합니다.' } });
        expect(userFixture.rpc).not.toHaveBeenCalled();
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
        expect(events).toEqual(['get-user', 'get-aal', 'get-profile', 'create-admin-client', 'reset-password']);
        expect(createAdminClient).toHaveBeenCalledOnce();
        expect(adminFixture.updateUserById).toHaveBeenCalledWith(accountId, { password: validPasswordBody.temporaryPassword });
    });

    it('accepts an eight-character password containing mixed whitespace and one non-whitespace character', async () => {
        const temporaryPassword = ' \t\n\r x  ';
        const adminFixture = createAdminClientFixture();
        const { app } = createApp({ adminFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: { temporaryPassword } }), {});

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(adminFixture.updateUserById).toHaveBeenCalledWith(accountId, { password: temporaryPassword });
    });

    it.each([[callerId], [callerId.toUpperCase()]])('forbids resetting the current administrator password through account management: %s', async (targetId) => {
        const events = [];
        const userFixture = createUserClientFixture({ events });
        const adminFixture = createAdminClientFixture({
            events,
            updateResultFactory: () => ({ data: { user: { id: callerId, email: 'admin@example.com' } }, error: null })
        });
        const { app, createAdminClient } = createApp({ userFixture, adminFixture, events });
        const response = await app.fetch(request(`/api/admin/accounts/${targetId}/password`, { method: 'POST', body: validPasswordBody }), {});

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body).toEqual({ error: { code: 'self_password_reset_forbidden', message: '현재 관리자 계정의 비밀번호는 이 방식으로 변경할 수 없습니다.' } });
        expect(events).toEqual(['get-user', 'get-aal', 'get-profile']);
        expect(createAdminClient).not.toHaveBeenCalled();
        expect(adminFixture.updateUserById).not.toHaveBeenCalled();
        expect(JSON.stringify(body)).not.toContain(validPasswordBody.temporaryPassword);
        expect(JSON.stringify(body)).not.toContain('session-token');
    });

    it('resets only another account\'s TOTP factors and returns no factor details', async () => {
        const firstFactorId = '33333333-3333-4333-8333-333333333333';
        const secondFactorId = '44444444-4444-4444-8444-444444444444';
        const adminFixture = createAdminClientFixture({
            factors: [
                { id: firstFactorId, factor_type: 'totp', status: 'verified', friendly_name: 'must-not-leak-primary' },
                { id: secondFactorId, factor_type: 'totp', status: 'unverified', friendly_name: 'must-not-leak-backup' },
                { id: '55555555-5555-4555-8555-555555555555', factor_type: 'phone', status: 'verified' }
            ]
        });
        const { app } = createApp({ adminFixture });

        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/mfa-reset`, { method: 'POST' }), {});

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(adminFixture.listFactors).toHaveBeenCalledWith({ userId: accountId });
        expect(adminFixture.deleteFactor).toHaveBeenNthCalledWith(1, { id: firstFactorId, userId: accountId });
        expect(adminFixture.deleteFactor).toHaveBeenNthCalledWith(2, { id: secondFactorId, userId: accountId });
        expect(adminFixture.deleteFactor).toHaveBeenCalledTimes(2);
    });

    it('treats an account without MFA factors as an idempotent reset', async () => {
        const adminFixture = createAdminClientFixture({ factors: [] });
        const { app } = createApp({ adminFixture });

        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/mfa-reset`, { method: 'POST' }), {});

        expect(response.status).toBe(204);
        expect(adminFixture.listFactors).toHaveBeenCalledWith({ userId: accountId });
        expect(adminFixture.deleteFactor).not.toHaveBeenCalled();
    });

    it('redacts malformed MFA factor lists without attempting deletion', async () => {
        const adminFixture = createAdminClientFixture();
        adminFixture.listFactors.mockResolvedValueOnce({ data: { factors: 'raw-factor-list' }, error: null });
        const { app } = createApp({ adminFixture });

        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/mfa-reset`, { method: 'POST' }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(adminFixture.deleteFactor).not.toHaveBeenCalled();
        expect(JSON.stringify(body)).not.toContain('raw-factor-list');
    });

    it('redacts blank MFA factor identifiers without attempting deletion', async () => {
        const adminFixture = createAdminClientFixture({ factors: [{ id: '   ', factor_type: 'totp' }] });
        const { app } = createApp({ adminFixture });

        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/mfa-reset`, { method: 'POST' }), {});

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(adminFixture.deleteFactor).not.toHaveBeenCalled();
    });

    it('continues MFA factor cleanup but redacts a partial provider failure', async () => {
        const firstFactorId = '33333333-3333-4333-8333-333333333333';
        const secondFactorId = '44444444-4444-4444-8444-444444444444';
        const adminFixture = createAdminClientFixture({
            factors: [
                { id: firstFactorId, factor_type: 'totp', status: 'verified' },
                { id: secondFactorId, factor_type: 'totp', status: 'verified' }
            ],
            deleteFactorResultFactory: ({ id }) => (id === firstFactorId ? { data: null, error: new Error('raw factor provider detail') } : { data: { id }, error: null })
        });
        const { app } = createApp({ adminFixture });

        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/mfa-reset`, { method: 'POST' }), {});
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(adminFixture.deleteFactor).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(body)).not.toContain(firstFactorId);
        expect(JSON.stringify(body)).not.toContain('raw factor provider detail');
    });

    it('forbids an administrator from resetting their own MFA before constructing the secret client', async () => {
        const { app, createAdminClient } = createApp();

        const response = await app.fetch(request(`/api/admin/accounts/${callerId.toUpperCase()}/mfa-reset`, { method: 'POST' }), {});

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code: 'self_mfa_reset_forbidden', message: '현재 관리자 계정의 인증 앱은 이 방식으로 초기화할 수 없습니다.' } });
        expect(createAdminClient).not.toHaveBeenCalled();
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
        ['undefined provider result', () => undefined],
        ['null provider result', () => null],
        ['mismatched returned user', () => ({ data: { user: { id: '22222222-2222-4222-8222-222222222222', private_note: 'raw mismatched user detail' } }, error: null })]
    ])('rejects and redacts a malformed password reset success: %s', async (_label, updateResultFactory) => {
        const adminFixture = createAdminClientFixture({ updateResultFactory });
        const { app } = createApp({ adminFixture });
        const response = await app.fetch(request(`/api/admin/accounts/${accountId}/password`, { method: 'POST', body: validPasswordBody }), {});

        expect(response.status).toBe(502);
        const body = await response.json();
        expect(body).toEqual({ error: { code: 'upstream_error', message: '계정 관리 서비스를 사용할 수 없습니다.' } });
        expect(JSON.stringify(body)).not.toContain('raw mismatched user detail');
        expect(JSON.stringify(body)).not.toContain(validPasswordBody.temporaryPassword);
        expect(JSON.stringify(body)).not.toContain('session-token');
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
