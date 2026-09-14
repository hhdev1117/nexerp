import { describe, it, expect, vi } from 'vitest';
import { createHrModuleRepository } from './hrModuleRepository';
const company = '11111111-1111-4111-8111-111111111111';
const core = { key: 'hr.core', label: '인사 기본', available: true, state: 'enabled', menuVisible: true, revision: 0, pendingActions: 0, dependents: [] };
const settings = () => ({ companyId: company, modules: [{ ...core }] });
describe('HR module settings repository', () => {
    it('uses exact company scoped load and revisioned save contracts', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: settings() });
        const repo = createHrModuleRepository({ rpc });
        expect(await repo.loadSettings(company)).toEqual(settings());
        expect(rpc).toHaveBeenLastCalledWith('hr_module_settings', { target_company: company });
        expect(await repo.saveSettings(company, 'hr.core', 0, 'draining', false, 'settle actions')).toEqual(settings());
        expect(rpc).toHaveBeenLastCalledWith('hr_save_module_settings', { target_company: company, module_key: 'hr.core', expected_revision: 0, desired_state: 'draining', menu_visible: false, change_reason: 'settle actions' });
    });
    it('rejects foreign company, duplicate modules, malformed and contradictory module data', async () => {
        const bad = [null, {}, { ...settings(), companyId: 'foreign' }, { ...settings(), modules: [] }, { ...settings(), modules: [core, core] }];
        for (const patch of [
            { key: '' },
            { label: '' },
            { available: 'true' },
            { state: 'unknown' },
            { menuVisible: null },
            { revision: -1 },
            { revision: 1.5 },
            { pendingActions: -1 },
            { dependents: [false] },
            { available: false },
            { available: false, state: 'disabled', menuVisible: false, pendingActions: 1 }
        ])
            bad.push({ ...settings(), modules: [{ ...core, ...patch }] });
        for (const data of bad) await expect(createHrModuleRepository({ rpc: async () => ({ data }) }).loadSettings(company)).rejects.toMatchObject({ code: 'hr_module_request_failed' });
    });
    it('accepts planned modules and all supported states', async () => {
        for (const state of ['enabled', 'draining', 'read_only', 'disabled']) {
            const data = {
                ...settings(),
                modules: [
                    { ...core, state },
                    { ...core, key: 'hr.payroll', available: false, state: 'disabled', menuVisible: false }
                ]
            };
            expect(await createHrModuleRepository({ rpc: async () => ({ data }) }).loadSettings(company)).toEqual(data);
        }
    });
    it.each([
        ['22023', 'module_pending_actions', 'module_pending_actions'],
        ['22023', 'module_unavailable', 'module_unavailable'],
        ['40001', 'secret', 'revision_conflict'],
        ['42501', 'secret', 'access_denied'],
        ['other', 'module_pending_actions', 'hr_module_request_failed'],
        ['22023', 'secret', 'hr_module_request_failed']
    ])('sanitizes %s/%s', async (code, message, expected) => {
        const repo = createHrModuleRepository({ rpc: async () => ({ error: { code, message } }) });
        await expect(repo.loadSettings(company)).rejects.toMatchObject({ code: expected });
        await expect(repo.loadSettings(company)).rejects.not.toThrow(message);
    });
    it('rejects invalid company before transport and sanitizes missing client', async () => {
        const rpc = vi.fn();
        await expect(createHrModuleRepository({ rpc }).loadSettings('bad')).rejects.toThrow();
        expect(rpc).not.toHaveBeenCalled();
        await expect(createHrModuleRepository(null).loadSettings(company)).rejects.toThrow();
    });
});
