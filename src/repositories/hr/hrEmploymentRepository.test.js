import { describe, expect, it, vi } from 'vitest';
import { createHrEmploymentRepository } from './hrEmploymentRepository';
const company = '11111111-1111-4111-8111-111111111111';
const employee = '22222222-2222-4222-8222-222222222222';
const employment = '33333333-3333-4333-8333-333333333333';
const profile = '44444444-4444-4444-8444-444444444444';
const action = '55555555-5555-4555-8555-555555555555';
const history = () => ({
    companyId: company,
    employeeId: employee,
    employeeRevision: 4,
    permissions: { create: true, cancel: true },
    employments: [{
        id: employment,
        sequenceNo: 1,
        hireDate: '2020-01-01',
        endDate: '2026-09-15',
        status: 'terminated',
        siteId: null,
        department: 'D1',
        grade: 'G1',
        position: 'P1',
        cancelled: false,
        cancellationReason: null,
        accountChanged: false,
        actions: [{ id: action, type: 'terminate', effectiveDate: '2026-09-15', siteId: null, department: 'D1', grade: 'G1', position: 'P1', reason: '퇴사', cancelled: false }]
    }]
});
const preparation = () => ({
    companyId: company,
    employeeId: employee,
    employeeRevision: 4,
    eligible: true,
    earliestHireDate: '2026-09-16',
    currentAccount: null,
    accountCandidates: [{ id: profile, name: '김계정', preview: { level: 1, source: 'grade' } }],
    sites: [{ id: profile, name: '본사' }],
    references: [{ id: action, kind: 'grade', code: 'G1', name: '사원' }],
    mappings: [{ kind: 'grade', code: 'G1', level: 1, from: null, to: null }],
    permissions: { create: true }
});
describe('HR employment repository', () => {
    it('uses exact history, preparation, create and cancellation contracts', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce({ data: history() })
            .mockResolvedValueOnce({ data: preparation() })
            .mockResolvedValue({ data: history() });
        const repo = createHrEmploymentRepository({ rpc });
        expect(await repo.loadHistory(company, employee)).toEqual(history());
        expect(rpc).toHaveBeenLastCalledWith('hr_employment_history', { target_company: company, target_employee: employee });
        expect(await repo.prepareRehire(company, employee)).toEqual(preparation());
        expect(rpc).toHaveBeenLastCalledWith('hr_prepare_rehire', { target_company: company, target_employee: employee });
        const document = { hireDate: '2026-10-01', siteId: null, department: 'D1', grade: 'G1', position: 'P1', accountMode: 'replace', profileId: profile };
        await repo.createReemployment(company, employee, 4, document, '재입사 승인');
        expect(rpc).toHaveBeenLastCalledWith('hr_create_reemployment', { target_company: company, target_employee: employee, expected_revision: 4, employment_document: document, change_reason: '재입사 승인' });
        await repo.cancelPlanned(company, employee, employment, 5, '일정 취소');
        expect(rpc).toHaveBeenLastCalledWith('hr_cancel_planned_employment', { target_company: company, target_employee: employee, target_employment: employment, expected_revision: 5, change_reason: '일정 취소' });
    });
    it('rejects malformed histories and duplicate cycle identities', async () => {
        const bad = [
            null,
            { ...history(), companyId: 'foreign' },
            { ...history(), employeeRevision: 0 },
            { ...history(), permissions: { create: true } },
            { ...history(), employments: [history().employments[0], history().employments[0]] }
        ];
        for (const patch of [
            { sequenceNo: 0 },
            { hireDate: 'bad' },
            { endDate: 'bad' },
            { status: 'unknown' },
            { siteId: 'bad' },
            { cancelled: 'false' },
            { cancelled: true, cancellationReason: null },
            { accountChanged: null },
            { actions: [{ ...history().employments[0].actions[0], type: 'hire' }] }
        ]) bad.push({ ...history(), employments: [{ ...history().employments[0], ...patch }] });
        for (const data of bad) await expect(createHrEmploymentRepository({ rpc: async () => ({ data }) }).loadHistory(company, employee)).rejects.toMatchObject({ code: 'hr_employment_request_failed' });
    });
    it('validates preparation candidates, mappings and eligibility dates', async () => {
        const bad = [
            { ...preparation(), employeeId: 'foreign' },
            { ...preparation(), eligible: 'true' },
            { ...preparation(), earliestHireDate: null },
            { ...preparation(), currentAccount: {} },
            { ...preparation(), accountCandidates: [{ id: profile, name: '계정', preview: { level: 6, source: 'grade' } }] },
            { ...preparation(), mappings: [{ kind: 'team', code: 'G1', level: 1, from: null, to: null }] },
            { ...preparation(), permissions: { create: 1 } }
        ];
        for (const data of bad) await expect(createHrEmploymentRepository({ rpc: async () => ({ data }) }).prepareRehire(company, employee)).rejects.toMatchObject({ code: 'hr_employment_request_failed' });
    });
    it.each([
        ['40001', 'secret', 'revision_conflict'],
        ['42501', 'secret', 'access_denied'],
        ['22023', 'rehire_not_allowed', 'rehire_not_allowed'],
        ['22023', 'employment_overlap', 'employment_overlap'],
        ['22023', 'account_unavailable', 'account_unavailable'],
        ['22023', 'invalid_employment', 'invalid_employment'],
        ['22023', 'planned_employment_required', 'planned_employment_required'],
        ['other', 'employment_overlap', 'hr_employment_request_failed']
    ])('sanitizes %s/%s errors', async (code, message, expected) => {
        const repo = createHrEmploymentRepository({ rpc: async () => ({ error: { code, message } }) });
        await expect(repo.loadHistory(company, employee)).rejects.toMatchObject({ code: expected });
        await expect(repo.loadHistory(company, employee)).rejects.not.toThrow('secret');
    });
    it('rejects invalid IDs before transport', async () => {
        const rpc = vi.fn();
        const repo = createHrEmploymentRepository({ rpc });
        await expect(repo.loadHistory('bad', employee)).rejects.toThrow();
        await expect(repo.loadHistory(company, 'bad')).rejects.toThrow();
        await expect(repo.cancelPlanned(company, employee, 'bad', 1, '사유')).rejects.toThrow();
        expect(rpc).not.toHaveBeenCalled();
    });
});
