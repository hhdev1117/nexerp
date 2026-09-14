import { describe, expect, it, vi } from 'vitest';
import { createEnterpriseAccessRepository } from './enterpriseAccessRepository';

const mock = (result) => {
    const client = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result), rpc: vi.fn().mockResolvedValue(result) };
    client.from.mockReturnValue(client);
    client.select.mockReturnValue(client);
    client.eq.mockReturnValue(client);
    return client;
};
describe('enterprise policy repository', () => {
    it('loads only the requested company and returns revision zero for no draft', async () => {
        const client = mock({ data: null });
        expect(await createEnterpriseAccessRepository(client).load('company')).toEqual({ policy: null, revision: 0 });
        expect(client.eq).toHaveBeenCalledWith('company_id', 'company');
    });
    it('saves atomically with revision and reason', async () => {
        const policy = { levels: [] };
        const client = mock({ data: [{ policy, revision: 2 }] });
        expect(await createEnterpriseAccessRepository(client).save('company', policy, 1, 'reviewed')).toEqual({ policy, revision: 2 });
        expect(client.rpc).toHaveBeenCalledWith('enterprise_save_access_policy', { target_company: 'company', policy_document: policy, expected_revision: 1, change_reason: 'reviewed' });
    });
    it.each([
        ['40001', 'revision_conflict'],
        ['42501', 'access_denied'],
        ['22023', 'invalid_policy']
    ])('maps %s', async (code, expected) => {
        await expect(createEnterpriseAccessRepository(mock({ error: { code } })).save('c', {}, 0, 'why')).rejects.toMatchObject({ code: expected });
    });
    it('does not silently replace unavailable storage or malformed save results with demo policy', async () => {
        await expect(createEnterpriseAccessRepository(null).load('c')).rejects.toMatchObject({ code: 'access_not_configured' });
        await expect(createEnterpriseAccessRepository(mock({ error: { code: 'network' } })).load('c')).rejects.toMatchObject({ code: 'access_load_failed' });
        await expect(createEnterpriseAccessRepository(mock({ data: null })).save('c', {}, 0, 'why')).rejects.toMatchObject({ code: 'access_save_failed' });
    });
});

it('normalizes cleared date fields without mutating the draft', async () => {
    const policy = { members: [{ from: '', to: '' }], mappings: [{ from: '2026-09-14', to: '' }], overrides: [{ from: '', to: null }] };
    const client = mock({ data: { policy, revision: 1 } });
    await createEnterpriseAccessRepository(client).save('c', policy, 0, 'review');
    expect(client.rpc.mock.calls[0][1].policy_document.members[0]).toEqual({ from: null, to: null });
    expect(client.rpc.mock.calls[0][1].policy_document.mappings[0]).toEqual({ from: '2026-09-14', to: null });
    expect(policy.members[0].from).toBe('');
});
