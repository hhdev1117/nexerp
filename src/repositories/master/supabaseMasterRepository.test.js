import { describe, expect, it, vi } from 'vitest';
import { createSupabaseMasterRepository } from './supabaseMasterRepository';

const COMPANY_FIELDS = 'id, code, name, business_number, representative, address, is_active, created_at, updated_at';
const SITE_FIELDS = 'id, company_id, code, name, site_type, address, is_active, created_at, updated_at';

const companyRow = { id: 'c-1', code: 'NXM', name: '넥서스 제조', business_number: '1208812345', representative: '김정호', address: '인천', is_active: true, created_at: '2026-09-14T00:00:00.000Z', updated_at: '2026-09-14T01:00:00.000Z' };
const company = { id: 'c-1', code: 'NXM', name: '넥서스 제조', businessNumber: '1208812345', representative: '김정호', address: '인천', isActive: true, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T01:00:00.000Z' };
const siteRow = { id: 's-1', company_id: 'c-1', code: 'ICN', name: '인천 공장', site_type: 'factory', address: '인천', is_active: true, created_at: '2026-09-14T00:00:00.000Z', updated_at: '2026-09-14T01:00:00.000Z' };
const site = { id: 's-1', companyId: 'c-1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: true, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T01:00:00.000Z' };

const makeClient = ({ list = { data: [companyRow], error: null }, single = { data: companyRow, error: null } } = {}) => {
    const singleFn = vi.fn().mockResolvedValue(single);
    const writeSelect = vi.fn(() => ({ single: singleFn }));
    const order = vi.fn().mockResolvedValue(list);
    const select = vi.fn(() => ({ order }));
    const insert = vi.fn(() => ({ select: writeSelect }));
    const eq = vi.fn(() => ({ select: writeSelect }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select, insert, update }));

    return { client: { from }, from, select, order, insert, update, eq, writeSelect, single: singleFn };
};

describe('Supabase master repository', () => {
    it('lists companies ordered by code and maps columns to application fields', async () => {
        const fixture = makeClient();
        const repository = createSupabaseMasterRepository(fixture.client);

        await expect(repository.listCompanies()).resolves.toEqual([company]);
        expect(fixture.from).toHaveBeenCalledWith('companies');
        expect(fixture.select).toHaveBeenCalledWith(COMPANY_FIELDS);
        expect(fixture.order).toHaveBeenCalledWith('code');
    });

    it('lists sites with their company reference', async () => {
        const fixture = makeClient({ list: { data: [siteRow, { ...siteRow, id: 's-2', business_number: undefined, address: null, is_active: false }], error: null } });
        const repository = createSupabaseMasterRepository(fixture.client);

        await expect(repository.listSites()).resolves.toEqual([site, { ...site, id: 's-2', address: '', isActive: false }]);
        expect(fixture.from).toHaveBeenCalledWith('sites');
        expect(fixture.select).toHaveBeenCalledWith(SITE_FIELDS);
    });

    it('inserts companies with database column names and returns the persisted row', async () => {
        const fixture = makeClient();
        const repository = createSupabaseMasterRepository(fixture.client);

        await expect(repository.createCompany({ code: 'NXM', name: '넥서스 제조', businessNumber: '1208812345', representative: '김정호', address: '인천', isActive: true, extra: 'ignored' })).resolves.toEqual(company);
        expect(fixture.insert).toHaveBeenCalledWith({ code: 'NXM', name: '넥서스 제조', business_number: '1208812345', representative: '김정호', address: '인천', is_active: true });
        expect(fixture.writeSelect).toHaveBeenCalledWith(COMPANY_FIELDS);
        expect(fixture.single).toHaveBeenCalledOnce();
    });

    it('updates only the supplied fields of the targeted company', async () => {
        const fixture = makeClient({ single: { data: { ...companyRow, is_active: false }, error: null } });
        const repository = createSupabaseMasterRepository(fixture.client);

        await expect(repository.updateCompany('c-1', { isActive: false })).resolves.toMatchObject({ id: 'c-1', isActive: false });
        expect(fixture.update).toHaveBeenCalledWith({ is_active: false });
        expect(fixture.eq).toHaveBeenCalledWith('id', 'c-1');
        expect(fixture.writeSelect).toHaveBeenCalledWith(COMPANY_FIELDS);
    });

    it('creates and updates sites with column mapping', async () => {
        const fixture = makeClient({ single: { data: siteRow, error: null } });
        const repository = createSupabaseMasterRepository(fixture.client);

        await expect(repository.createSite({ companyId: 'c-1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: true })).resolves.toEqual(site);
        expect(fixture.insert).toHaveBeenCalledWith({ company_id: 'c-1', code: 'ICN', name: '인천 공장', site_type: 'factory', address: '인천', is_active: true });
        expect(fixture.writeSelect).toHaveBeenCalledWith(SITE_FIELDS);

        await expect(repository.updateSite('s-1', { name: '인천 제1공장', siteType: 'factory' })).resolves.toEqual(site);
        expect(fixture.update).toHaveBeenCalledWith({ name: '인천 제1공장', site_type: 'factory' });
        expect(fixture.eq).toHaveBeenCalledWith('id', 's-1');
    });

    it.each([
        [{ code: '23505', message: 'duplicate key value violates unique constraint "companies_code_key"' }, 'duplicate_code'],
        [{ code: '22023', message: 'company_inactive' }, 'company_inactive'],
        [{ code: '23514', message: 'new row for relation "companies" violates check constraint "companies_code_format"' }, 'invalid_value'],
        [{ code: '42501', message: 'new row violates row-level security policy for table "companies"' }, 'admin_required'],
        [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'not_found'],
        [{ code: '08006', message: 'sentinel-connection-string' }, 'master_save_failed']
    ])('maps provider error %j to a stable code without leaking details', async (error, expected) => {
        const fixture = makeClient({ single: { data: null, error } });
        const repository = createSupabaseMasterRepository(fixture.client);

        const failure = await repository.createCompany({ code: 'NXM', name: '넥서스' }).catch((cause) => cause);

        expect(failure).toMatchObject({ name: 'MasterRepositoryError', code: expected });
        expect(failure.message).not.toContain('sentinel');
        expect(failure.message).not.toContain('constraint');
        expect(failure.message).not.toContain('policy');
    });

    it('reports load failures separately and rejects unconfigured clients', async () => {
        const fixture = makeClient({ list: { data: null, error: new Error('sentinel-provider-secret') } });

        const failure = await createSupabaseMasterRepository(fixture.client)
            .listSites()
            .catch((cause) => cause);
        expect(failure).toMatchObject({ name: 'MasterRepositoryError', code: 'master_load_failed' });
        expect(failure.message).not.toContain('sentinel');
        await expect(createSupabaseMasterRepository(null).listCompanies()).rejects.toMatchObject({ code: 'master_not_configured' });
    });
});
