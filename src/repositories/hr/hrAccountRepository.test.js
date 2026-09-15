import { describe, it, expect, vi } from 'vitest';
import { createHrAccountRepository } from './hrAccountRepository';
const company = '11111111-1111-4111-8111-111111111111';
const employee = '22222222-2222-4222-8222-222222222222';
const profile = '33333333-3333-4333-8333-333333333333';
const options = () => ({
    companyId: company,
    employeeId: employee,
    employeeNo: 'E1',
    name: '김사원',
    revision: 2,
    status: 'active',
    grade: 'STAFF',
    position: 'MEMBER',
    account: null,
    candidates: [{ id: profile, name: '김계정', preview: { level: 1, source: 'grade' } }],
    permissions: { link: true, unlink: false }
});
describe('HR employee account repository', () => {
    it('uses exact company, employee and revision contracts', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: options() });
        const repo = createHrAccountRepository({ rpc });
        expect(await repo.loadOptions(company, employee)).toEqual(options());
        expect(rpc).toHaveBeenLastCalledWith('hr_account_link_options', { target_company: company, target_employee: employee });
        await repo.linkAccount(company, employee, 2, profile, '담당자 연결');
        expect(rpc).toHaveBeenLastCalledWith('hr_link_employee_account', {
            target_company: company,
            target_employee: employee,
            expected_revision: 2,
            target_profile: profile,
            change_reason: '담당자 연결'
        });
    });
    it('validates options, previews and history instead of trusting RPC data', async () => {
        for (const data of [
            null,
            { ...options(), companyId: 'foreign' },
            { ...options(), revision: 0 },
            { ...options(), status: 'unknown' },
            { ...options(), account: {} },
            { ...options(), candidates: [{ id: profile, name: '계정', preview: { level: 6, source: 'grade' } }] },
            { ...options(), permissions: { link: true } }
        ])
            await expect(createHrAccountRepository({ rpc: async () => ({ data }) }).loadOptions(company, employee)).rejects.toMatchObject({ code: 'hr_account_request_failed' });
        const good = [{ id: profile, beforeAccountId: null, afterAccountId: profile, beforeAccountName: '-', afterAccountName: '김계정', reason: '연결', createdAt: '2026-09-15T00:00:00Z' }];
        expect(await createHrAccountRepository({ rpc: async () => ({ data: good }) }).loadHistory(company, employee)).toEqual(good);
    });
    it.each([
        ['40001', 'secret', 'revision_conflict'],
        ['42501', 'secret', 'access_denied'],
        ['22023', 'account_unavailable', 'account_unavailable'],
        ['22023', 'employee_terminated', 'employee_terminated'],
        ['other', 'account_unavailable', 'hr_account_request_failed']
    ])('sanitizes %s/%s', async (code, message, expected) => {
        const repo = createHrAccountRepository({ rpc: async () => ({ error: { code, message } }) });
        await expect(repo.loadOptions(company, employee)).rejects.toMatchObject({ code: expected });
        await expect(repo.loadOptions(company, employee)).rejects.not.toThrow('secret');
    });
    it('rejects invalid identifiers before transport', async () => {
        const rpc = vi.fn();
        await expect(createHrAccountRepository({ rpc }).loadOptions('bad', employee)).rejects.toThrow();
        await expect(createHrAccountRepository({ rpc }).loadOptions(company, 'bad')).rejects.toThrow();
        expect(rpc).not.toHaveBeenCalled();
    });
});
