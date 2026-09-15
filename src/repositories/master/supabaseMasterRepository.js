import { getSupabaseClient } from '@/lib/supabase/client';
import { normalizeBusinessNumber, normalizeCode, normalizeText } from '@/data/master';
import { MasterRepositoryError, masterError } from './errors';

const COMPANY_FIELDS = 'id, code, name, business_number, representative, address, is_active, created_at, updated_at';
const SITE_FIELDS = 'id, company_id, code, name, site_type, address, is_active, created_at, updated_at';
const PARTNER_FIELDS = 'id, company_id, code, name, business_number, is_customer, is_vendor, representative, contact_name, email, phone, address, payment_terms_days, credit_limit, is_active, created_at, updated_at';

const companyColumns = Object.freeze({ code: 'code', name: 'name', businessNumber: 'business_number', representative: 'representative', address: 'address', isActive: 'is_active' });
const siteColumns = Object.freeze({ companyId: 'company_id', code: 'code', name: 'name', siteType: 'site_type', address: 'address', isActive: 'is_active' });
const partnerColumns = Object.freeze({
    companyId: 'company_id',
    code: 'code',
    name: 'name',
    businessNumber: 'business_number',
    isCustomer: 'is_customer',
    isVendor: 'is_vendor',
    representative: 'representative',
    contactName: 'contact_name',
    email: 'email',
    phone: 'phone',
    address: 'address',
    paymentTermsDays: 'payment_terms_days',
    creditLimit: 'credit_limit',
    isActive: 'is_active'
});
const partnerUpdateColumns = Object.freeze(Object.fromEntries(Object.entries(partnerColumns).filter(([key]) => key !== 'code')));
const partnerTextFields = Object.freeze(['companyId', 'name', 'representative', 'contactName', 'email', 'phone', 'address']);

const toCompany = (row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    businessNumber: row.business_number ?? null,
    representative: row.representative ?? '',
    address: row.address ?? '',
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

const toSite = (row) => ({
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    siteType: row.site_type,
    address: row.address ?? '',
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

const toPartner = (row) => ({
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    businessNumber: row.business_number ?? null,
    isCustomer: row.is_customer === true,
    isVendor: row.is_vendor === true,
    representative: row.representative ?? '',
    contactName: row.contact_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    address: row.address ?? '',
    paymentTermsDays: row.payment_terms_days ?? 30,
    creditLimit: row.credit_limit ?? 0,
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

const normalizePartnerValues = (values) => {
    const normalized = { ...values };
    if (values?.code !== undefined && typeof values.code === 'string') normalized.code = normalizeCode(values.code);
    for (const key of partnerTextFields) {
        if (typeof values?.[key] === 'string') normalized[key] = normalizeText(values[key]);
    }
    if (values?.businessNumber !== undefined) {
        if (values.businessNumber === null || (typeof values.businessNumber === 'string' && !values.businessNumber.trim())) {
            normalized.businessNumber = null;
        } else {
            const businessNumber = normalizeBusinessNumber(values.businessNumber);
            if (!businessNumber) throw masterError('invalid_value');
            normalized.businessNumber = businessNumber;
        }
    }
    return normalized;
};

// Only keys the caller supplied become columns, so partial updates never overwrite other fields.
const toRow = (columns, values) =>
    Object.fromEntries(
        Object.entries(columns)
            .filter(([key]) => values?.[key] !== undefined)
            .map(([key, column]) => [column, values[key]])
    );

// PostgREST surfaces PostgreSQL error codes; map them to stable application codes and never leak details.
const failure = (operation, source) => {
    if (source instanceof MasterRepositoryError) return source;
    const code = typeof source?.code === 'string' ? source.code : '';
    const message = typeof source?.message === 'string' ? source.message : '';
    const providerContext = [source?.constraint, source?.details, message].filter((value) => typeof value === 'string').join(' ');

    if (code === '23505' && /companies_business_number_key|partners_company_business_number_key|\(company_id,\s*business_number\)/i.test(providerContext)) return masterError('duplicate_business_number');
    if (code === '23505') return masterError('duplicate_code');
    if (message === 'company_inactive') return masterError('company_inactive');
    if (code === '23514' || code === '22023' || code === '23502' || code === '22P02') return masterError('invalid_value');
    if (code === '23503') return masterError('not_found');
    if (code === '42501') return masterError('admin_required');
    if (code === 'PGRST116') return masterError('not_found');
    return masterError(operation === 'load' ? 'master_load_failed' : 'master_save_failed');
};

const ensureClient = (client) => {
    if (!client) throw masterError('master_not_configured');
};

export function createSupabaseMasterRepository(client = getSupabaseClient()) {
    const run = async (operation, request, map) => {
        ensureClient(client);
        try {
            const { data, error } = await request();
            if (error) throw failure(operation, error);
            return map(data);
        } catch (error) {
            throw failure(operation, error);
        }
    };

    const list = (table, fields, map) =>
        run(
            'load',
            () => client.from(table).select(fields).order('code'),
            (data) => (Array.isArray(data) ? data.map(map) : [])
        );
    const insert = (table, fields, row, map) =>
        run(
            'save',
            () => client.from(table).insert(row).select(fields).single(),
            (data) => map(data)
        );
    const update = (table, fields, id, row, map) =>
        run(
            'save',
            () => client.from(table).update(row).eq('id', id).select(fields).single(),
            (data) => map(data)
        );

    const updatePartner = async (id, changes) => {
        const existing = await run(
            'save',
            () => client.from('partners').select('id').eq('id', id).maybeSingle(),
            (data) => data
        );
        if (!existing) throw masterError('not_found');

        try {
            return await update('partners', PARTNER_FIELDS, id, toRow(partnerUpdateColumns, normalizePartnerValues(changes)), toPartner);
        } catch (error) {
            if (error instanceof MasterRepositoryError && error.code === 'not_found') throw masterError('admin_required');
            throw error;
        }
    };

    return {
        listCompanies: () => list('companies', COMPANY_FIELDS, toCompany),
        createCompany: (draft) => insert('companies', COMPANY_FIELDS, toRow(companyColumns, draft), toCompany),
        updateCompany: (id, changes) => update('companies', COMPANY_FIELDS, id, toRow(companyColumns, changes), toCompany),
        listSites: () => list('sites', SITE_FIELDS, toSite),
        createSite: (draft) => insert('sites', SITE_FIELDS, toRow(siteColumns, draft), toSite),
        updateSite: (id, changes) => update('sites', SITE_FIELDS, id, toRow(siteColumns, changes), toSite),
        listPartners: () => list('partners', PARTNER_FIELDS, toPartner),
        createPartner: async (draft) => insert('partners', PARTNER_FIELDS, toRow(partnerColumns, normalizePartnerValues(draft)), toPartner),
        updatePartner
    };
}
