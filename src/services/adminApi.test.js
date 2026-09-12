import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, createAdminApi } from './adminApi';

const account = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'employee@nexerp.test',
    displayName: '김서준',
    department: '영업팀',
    role: 'user',
    isActive: true,
    createdAt: '2026-09-12T01:00:00.000Z',
    updatedAt: '2026-09-12T01:00:00.000Z'
};

const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });

describe('administrator API service', () => {
    let fetchImpl;
    let getAccessToken;

    beforeEach(() => {
        fetchImpl = vi.fn();
        getAccessToken = vi.fn().mockResolvedValue('current-session-token');
    });

    it('loads accounts with the current bearer token', async () => {
        fetchImpl.mockResolvedValue(response({ accounts: [account] }));
        const api = createAdminApi({ fetchImpl, getAccessToken });

        await expect(api.listAccounts()).resolves.toEqual([account]);

        expect(fetchImpl).toHaveBeenCalledWith('/api/admin/accounts', {
            method: 'GET',
            headers: { Authorization: 'Bearer current-session-token' }
        });
    });

    it('loads normalized infrastructure usage for the selected range', async () => {
        const usage = {
            generatedAt: '2026-09-12T03:04:05.000Z',
            range: { key: '7d', start: '2026-09-05T03:04:05.000Z', end: '2026-09-12T03:04:05.000Z' },
            providers: { supabase: { state: 'partial' }, cloudflare: { state: 'ok' } }
        };
        fetchImpl.mockResolvedValue(response(usage));
        const api = createAdminApi({ fetchImpl, getAccessToken });

        await expect(api.getInfrastructureUsage('7d')).resolves.toEqual(usage);
        expect(fetchImpl).toHaveBeenCalledWith('/api/admin/infrastructure/usage?range=7d', {
            method: 'GET',
            headers: { Authorization: 'Bearer current-session-token' }
        });
    });

    it('rejects malformed infrastructure usage without retaining raw fields', async () => {
        fetchImpl.mockResolvedValue(response({ generatedAt: 'raw-sentinel', providers: { supabase: { state: 'ok' } } }));
        const api = createAdminApi({ fetchImpl, getAccessToken });

        const failure = await api.getInfrastructureUsage('24h').catch((error) => error);

        expect(failure).toMatchObject({ name: 'AdminApiError', code: 'invalid_response' });
        expect(failure.message).not.toContain('raw-sentinel');
    });

    it('sends the temporary password only in the account creation request', async () => {
        fetchImpl.mockResolvedValue(response({ account }, 201));
        const api = createAdminApi({ fetchImpl, getAccessToken });
        const input = {
            email: 'employee@nexerp.test',
            temporaryPassword: 'One-Time-Password-9!',
            displayName: '김서준',
            department: '영업팀',
            role: 'user'
        };

        await expect(api.createAccount(input)).resolves.toEqual(account);

        const [, options] = fetchImpl.mock.calls[0];
        expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer current-session-token', 'Content-Type': 'application/json' } });
        expect(JSON.parse(options.body)).toEqual(input);
        expect(JSON.stringify(account)).not.toContain(input.temporaryPassword);
    });

    it('updates only the selected account profile fields', async () => {
        fetchImpl.mockResolvedValue(response({ account: { ...account, role: 'approver', isActive: false } }));
        const api = createAdminApi({ fetchImpl, getAccessToken });
        const input = { displayName: '김서준', department: '영업팀', role: 'approver', isActive: false };

        await expect(api.updateAccount(account.id, input)).resolves.toMatchObject({ role: 'approver', isActive: false });

        expect(fetchImpl).toHaveBeenCalledWith(`/api/admin/accounts/${account.id}`, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer current-session-token', 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    });

    it('sends a password reset to the selected account and accepts an empty 204 response', async () => {
        fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
        const api = createAdminApi({ fetchImpl, getAccessToken });
        const temporaryPassword = 'Replacement-Password-2!';

        await expect(api.resetAccountPassword(account.id, temporaryPassword)).resolves.toBeUndefined();

        expect(fetchImpl).toHaveBeenCalledWith(`/api/admin/accounts/${account.id}/password`, {
            method: 'POST',
            headers: { Authorization: 'Bearer current-session-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ temporaryPassword })
        });
    });

    it('normalizes password reset API failures without exposing provider text', async () => {
        fetchImpl.mockResolvedValue(response({ error: { code: 'account_not_found', message: 'sentinel-provider-detail' } }, 404));
        const api = createAdminApi({ fetchImpl, getAccessToken });

        const failure = await api.resetAccountPassword(account.id, 'Replacement-Password-2!').catch((error) => error);

        expect(failure).toBeInstanceOf(AdminApiError);
        expect(failure).toMatchObject({ code: 'account_not_found', message: '계정을 찾을 수 없습니다.', status: 404 });
        expect(JSON.stringify(failure)).not.toContain('sentinel-provider-detail');
        expect(JSON.stringify(failure)).not.toContain('Replacement-Password-2!');
    });

    it('fails locally with a stable Korean error when there is no session', async () => {
        getAccessToken.mockResolvedValue(null);
        const api = createAdminApi({ fetchImpl, getAccessToken });

        await expect(api.listAccounts()).rejects.toMatchObject({
            name: 'AdminApiError',
            code: 'authentication_required',
            message: '로그인이 필요합니다. 다시 로그인해 주세요.'
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('maps known API failures without trusting provider text', async () => {
        fetchImpl.mockResolvedValue(response({ error: { code: 'email_exists', message: 'sentinel-provider-detail' } }, 409));
        const api = createAdminApi({ fetchImpl, getAccessToken });

        const failure = await api.createAccount({}).catch((error) => error);

        expect(failure).toBeInstanceOf(AdminApiError);
        expect(failure).toMatchObject({ code: 'email_exists', message: '이미 사용 중인 이메일입니다.' });
        expect(JSON.stringify(failure)).not.toContain('sentinel-provider-detail');
    });

    it('normalizes malformed and network responses without leaking raw details', async () => {
        const api = createAdminApi({ fetchImpl, getAccessToken });
        fetchImpl.mockRejectedValueOnce(new Error('sentinel-private-network-detail'));
        const networkFailure = await api.listAccounts().catch((error) => error);

        fetchImpl.mockResolvedValueOnce(new Response('sentinel-private-html-detail', { status: 502 }));
        const malformedFailure = await api.listAccounts().catch((error) => error);

        expect(networkFailure.message).toBe('계정 관리 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        expect(malformedFailure.message).toBe('계정 관리 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        expect(`${networkFailure.message}${malformedFailure.message}`).not.toContain('sentinel-private');
    });
});
