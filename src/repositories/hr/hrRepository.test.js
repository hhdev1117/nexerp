import { describe, it, expect, vi } from 'vitest';
import { createHrRepository } from './hrRepository';

const company = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const directory = () => ({ employees: [], total: 0, page: 1, pageSize: 25, permissions: { create: false, update: false }, sites: [], accounts: [] });
const employee = () => ({
    id,
    companyId: company,
    employeeNo: 'E1',
    name: 'Kim',
    profileId: null,
    hireDate: '2026-09-14',
    siteId: null,
    department: '',
    grade: '',
    position: '',
    status: 'active',
    revision: 1,
    actions: [{ id, type: 'terminate', effectiveDate: '2026-10-01', siteId: null, department: '', grade: '', position: '', reason: 'leave', cancelled: false }]
});

describe('HR repository', () => {
    it.each([undefined, null, {}, [{ id: 'bad', name: 'Kim' }], [{ id, name: null }]].map((accounts) => [accounts]))('rejects missing or malformed eligible accounts %j', async (accounts) => {
        await expect(createHrRepository({ rpc: async () => ({ data: { ...directory(), accounts } }) }).loadDirectory(company)).rejects.toThrow();
    });
    it('returns eligible account names for selection', async () => {
        const repo = createHrRepository({ rpc: async () => ({ data: { ...directory(), accounts: [{ id, name: 'Kim' }] } }) });
        expect((await repo.loadDirectory(company)).accounts).toEqual([{ id, name: 'Kim' }]);
    });
    it('accepts complete employee actions and rejects foreign company rows or malformed action fields', async () => {
        const row = employee();
        const data = { ...directory(), total: 1, employees: [row] };
        const repo = createHrRepository({ rpc: async () => ({ data }) });
        expect((await repo.loadDirectory(company)).employees[0].actions[0].type).toBe('terminate');
        row.companyId = id;
        await expect(repo.loadDirectory(company)).rejects.toThrow();
        row.companyId = company;
        row.actions[0].cancelled = 'false';
        await expect(repo.loadDirectory(company)).rejects.toThrow();
    });
    it('uses the company scoped RPC and preserves denied permissions', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: directory(), error: null });
        const result = await createHrRepository({ rpc }).loadDirectory(company);
        expect(rpc).toHaveBeenCalledWith('hr_directory', { target_company: company, search_text: '', page_number: 1 });
        expect(result.permissions).toEqual({ create: false, update: false });
    });
    it.each([null, {}, { ...directory(), permissions: { create: 'true', update: false } }, { ...directory(), employees: [{ id, companyId: id }] }, { ...directory(), total: -1 }])('rejects malformed directory %j', async (data) => {
        await expect(createHrRepository({ rpc: async () => ({ data }) }).loadDirectory(company)).rejects.toThrow();
    });
    it('sanitizes transport errors and rejects invalid mutation acknowledgments', async () => {
        const repo = createHrRepository({
            rpc: async () => {
                throw new Error('secret account');
            }
        });
        await expect(repo.loadDirectory(company)).rejects.not.toThrow('secret account');
        await expect(createHrRepository({ rpc: async () => ({ data: {} }) }).createEmployee(company, {}, 'reason')).rejects.toThrow();
    });
    it('sends revision and reason to exact write RPCs', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: id });
        const repo = createHrRepository({ rpc });
        await expect(repo.createEmployee(company, { name: 'Kim' }, 'hire')).resolves.toBe(id);
        expect(rpc).toHaveBeenLastCalledWith('hr_create_employee', { target_company: company, employee_document: { name: 'Kim' }, change_reason: 'hire' });
        await repo.recordAction(company, id, 3, { type: 'terminate' });
        expect(rpc).toHaveBeenLastCalledWith('hr_record_personnel_action', { target_company: company, target_employee: id, expected_revision: 3, action_document: { type: 'terminate' } });
        rpc.mockResolvedValue({ data: null });
        await repo.cancelAction(company, id, id, 4, 'cancel');
        expect(rpc).toHaveBeenLastCalledWith('hr_cancel_personnel_action', { target_company: company, target_employee: id, target_action: id, expected_revision: 4, change_reason: 'cancel' });
    });
});
