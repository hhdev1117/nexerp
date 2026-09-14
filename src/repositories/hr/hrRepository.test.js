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
        expect(result.permissions).toEqual({ create: false, update: false, cancel: false });
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

describe('reference and correction RPC contracts', () => {
    const reference = () => ({ id, companyId: company, kind: 'department', code: 'ENG', name: 'Engineering', parentCode: null, isActive: true, revision: 1 });
    it('loads company scoped catalog and validates every row and permission', async () => {
        const data = { items: [reference()], canManage: false };
        const rpc = vi.fn().mockResolvedValue({ data });
        const repo = createHrRepository({ rpc });
        expect(await repo.loadReferences(company)).toEqual(data);
        expect(rpc).toHaveBeenCalledWith('hr_reference_catalog', { target_company: company });
        for (const patch of [{ companyId: id }, { kind: 'other' }, { code: '' }, { name: ' ' }, { parentCode: 3 }, { isActive: 'true' }, { revision: 0 }, { kind: 'grade', parentCode: 'ENG' }]) {
            rpc.mockResolvedValue({ data: { ...data, items: [{ ...reference(), ...patch }] } });
            await expect(repo.loadReferences(company)).rejects.toThrow();
        }
        rpc.mockResolvedValue({ data: { items: [], canManage: 'true' } });
        await expect(repo.loadReferences(company)).rejects.toThrow();
    });
    it('sends exact save and correction arguments and validates acknowledgements', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: id });
        const repo = createHrRepository({ rpc });
        const doc = reference();
        await repo.saveReference(company, doc, 2, 'rename');
        expect(rpc).toHaveBeenLastCalledWith('hr_save_reference', { target_company: company, reference_document: doc, expected_revision: 2, change_reason: 'rename' });
        rpc.mockResolvedValue({ data: null });
        const correction = { name: 'Kim', hireDate: '2026-01-01' };
        await repo.correctEmployee(company, id, 3, correction, 'fix');
        expect(rpc).toHaveBeenLastCalledWith('hr_correct_employee', { target_company: company, target_employee: id, expected_revision: 3, correction_document: correction, change_reason: 'fix' });
        rpc.mockResolvedValue({ data: {} });
        await expect(repo.correctEmployee(company, id, 3, correction, 'fix')).rejects.toThrow();
        await expect(repo.saveReference(company, doc, 2, 'rename')).rejects.toThrow();
    });
    it('validates correction history dates and sanitizes failures', async () => {
        const row = { id, before: { name: 'Kim', hireDate: '2026-01-01' }, after: { name: 'Lee', hireDate: '2026-02-01' }, reason: 'fix', createdAt: '2026-09-14T00:00:00Z' };
        const rpc = vi.fn().mockResolvedValue({ data: [row] });
        const repo = createHrRepository({ rpc });
        expect(await repo.loadCorrections(company, id)).toEqual([row]);
        expect(rpc).toHaveBeenLastCalledWith('hr_employee_corrections', { target_company: company, target_employee: id });
        rpc.mockResolvedValue({ data: [{ ...row, after: { name: 'Lee', hireDate: '2026-02-30' } }] });
        await expect(repo.loadCorrections(company, id)).rejects.toThrow();
        rpc.mockRejectedValue(new Error('private SQL'));
        await expect(repo.loadCorrections(company, id)).rejects.not.toThrow('private SQL');
    });
});

it.each(['reference_in_use', 'invalid_parent', 'immutable_reference', 'invalid_correction_date'])('only maps trusted database error %s', async (message) => {
    const repo = createHrRepository({ rpc: async () => ({ error: { code: '22023', message } }) });
    await expect(repo.loadReferences(company)).rejects.toMatchObject({ code: message });
    const unsafe = createHrRepository({ rpc: async () => ({ error: { code: 'other', message } }) });
    await expect(unsafe.loadReferences(company)).rejects.toMatchObject({ code: 'hr_request_failed' });
});

it('preserves nonempty legacy whitespace codes and department parent codes', async () => {
    const items = [
        { id, companyId: company, kind: 'department', code: ' ', name: '기존 공백 코드', parentCode: null, isActive: true, revision: 1 },
        { id, companyId: company, kind: 'department', code: 'child', name: 'Child', parentCode: ' ', isActive: true, revision: 1 }
    ];
    const repo = createHrRepository({ rpc: async () => ({ data: { items, canManage: true } }) });
    expect((await repo.loadReferences(company)).items).toEqual(items);
});

it('defaults legacy module state and cancellation safely, and validates explicit fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: directory() });
    const repo = createHrRepository({ rpc });
    expect(await repo.loadDirectory(company)).toMatchObject({ moduleState: 'enabled', permissions: { cancel: false } });
    for (const moduleState of ['enabled', 'draining', 'read_only', 'disabled']) {
        rpc.mockResolvedValue({ data: { ...directory(), moduleState, permissions: { create: false, update: false, cancel: true } } });
        expect(await repo.loadDirectory(company)).toMatchObject({ moduleState, permissions: { cancel: true } });
    }
    for (const patch of [{ moduleState: null }, { moduleState: 'unknown' }, { permissions: { create: false, update: false, cancel: null } }]) {
        rpc.mockResolvedValue({ data: { ...directory(), ...patch } });
        await expect(repo.loadDirectory(company)).rejects.toThrow();
    }
});
