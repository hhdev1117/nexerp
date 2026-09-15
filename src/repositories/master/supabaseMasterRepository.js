import { getSupabaseClient } from '@/lib/supabase/client';
import { normalizeBusinessNumber, normalizeCode, normalizeText, normalizeUnit } from '@/data/master';
import { MasterRepositoryError, masterError } from './errors';

const COMPANY_FIELDS = 'id, code, name, business_number, representative, address, is_active, created_at, updated_at';
const SITE_FIELDS = 'id, company_id, code, name, site_type, address, is_active, created_at, updated_at';
const PARTNER_FIELDS = 'id, company_id, code, name, business_number, is_customer, is_vendor, representative, contact_name, email, phone, address, payment_terms_days, credit_limit, is_active, created_at, updated_at';
const ITEM_FIELDS = 'id, company_id, code, name, item_type, unit, safety_stock, standard_price, is_active, created_at, updated_at';
const WAREHOUSE_FIELDS = 'id, company_id, site_id, code, name, warehouse_type, is_active, created_at, updated_at';
const ACCOUNT_FIELDS = 'id, company_id, parent_id, code, name, account_type, is_postable, is_active, created_at, updated_at';

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
const itemColumns = Object.freeze({ companyId: 'company_id', code: 'code', name: 'name', itemType: 'item_type', unit: 'unit', safetyStock: 'safety_stock', standardPrice: 'standard_price', isActive: 'is_active' });
const itemUpdateColumns = Object.freeze(Object.fromEntries(Object.entries(itemColumns).filter(([key]) => key !== 'code')));
const warehouseColumns = Object.freeze({ companyId: 'company_id', siteId: 'site_id', code: 'code', name: 'name', warehouseType: 'warehouse_type', isActive: 'is_active' });
const warehouseUpdateColumns = Object.freeze(Object.fromEntries(Object.entries(warehouseColumns).filter(([key]) => key !== 'code')));
const accountColumns = Object.freeze({ companyId: 'company_id', parentId: 'parent_id', code: 'code', name: 'name', accountType: 'account_type', isPostable: 'is_postable', isActive: 'is_active' });
const accountUpdateColumns = Object.freeze(Object.fromEntries(Object.entries(accountColumns).filter(([key]) => key !== 'code')));

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

const toItem = (row) => ({
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    itemType: row.item_type,
    unit: row.unit ?? 'EA',
    safetyStock: Number(row.safety_stock ?? 0),
    standardPrice: Number(row.standard_price ?? 0),
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

const normalizeItemValues = (values) => {
    const normalized = { ...values };
    if (typeof values?.code === 'string') normalized.code = normalizeCode(values.code);
    if (typeof values?.unit === 'string') normalized.unit = normalizeUnit(values.unit);
    for (const key of ['companyId', 'name']) {
        if (typeof values?.[key] === 'string') normalized[key] = normalizeText(values[key]);
    }
    for (const key of ['safetyStock', 'standardPrice']) {
        if (values?.[key] === undefined) continue;
        const amount = Number(values[key]);
        if (!Number.isFinite(amount) || amount < 0) throw masterError('invalid_value');
        normalized[key] = amount;
    }
    return normalized;
};

const toWarehouse = (row) => ({
    id: row.id,
    companyId: row.company_id,
    siteId: row.site_id,
    code: row.code,
    name: row.name,
    warehouseType: row.warehouse_type,
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

const normalizeWarehouseValues = (values) => {
    const normalized = { ...values };
    if (typeof values?.code === 'string') normalized.code = normalizeCode(values.code);
    for (const key of ['companyId', 'siteId', 'name']) {
        if (typeof values?.[key] === 'string') normalized[key] = normalizeText(values[key]);
    }
    return normalized;
};

const toAccount = (row) => ({
    id: row.id,
    companyId: row.company_id,
    parentId: row.parent_id ?? null,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    isPostable: row.is_postable === true,
    isActive: row.is_active === true,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
});

// Account codes are numeric, so they are trimmed rather than upper-cased.
const normalizeAccountValues = (values) => {
    const normalized = { ...values };
    for (const key of ['companyId', 'code', 'name']) {
        if (typeof values?.[key] === 'string') normalized[key] = normalizeText(values[key]);
    }
    if (values?.parentId !== undefined) normalized.parentId = typeof values.parentId === 'string' && values.parentId.trim() ? values.parentId.trim() : null;
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
    if (message === 'site_inactive') return masterError('site_inactive');
    if (message === 'site_company_mismatch') return masterError('site_company_mismatch');
    if (message === 'site_not_found') return masterError('site_not_found');
    for (const reason of ['parent_not_found', 'parent_company_mismatch', 'parent_type_mismatch', 'parent_is_postable', 'parent_inactive', 'invalid_parent']) {
        if (message === reason) return masterError(reason);
    }
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

    // A filtered-away update returns no row. Preflighting the id separates "gone" from "refused".
    const updateImmutableCode = async (table, fields, columns, normalize, map, id, changes) => {
        const existing = await run(
            'save',
            () => client.from(table).select('id').eq('id', id).maybeSingle(),
            (data) => data
        );
        if (!existing) throw masterError('not_found');

        try {
            return await update(table, fields, id, toRow(columns, normalize(changes)), map);
        } catch (error) {
            if (error instanceof MasterRepositoryError && error.code === 'not_found') throw masterError('admin_required');
            throw error;
        }
    };

    const updatePartner = (id, changes) => updateImmutableCode('partners', PARTNER_FIELDS, partnerUpdateColumns, normalizePartnerValues, toPartner, id, changes);
    const updateItem = (id, changes) => updateImmutableCode('items', ITEM_FIELDS, itemUpdateColumns, normalizeItemValues, toItem, id, changes);
    const updateWarehouse = (id, changes) => updateImmutableCode('warehouses', WAREHOUSE_FIELDS, warehouseUpdateColumns, normalizeWarehouseValues, toWarehouse, id, changes);
    const updateAccount = (id, changes) => updateImmutableCode('accounts', ACCOUNT_FIELDS, accountUpdateColumns, normalizeAccountValues, toAccount, id, changes);

    return {
        listCompanies: () => list('companies', COMPANY_FIELDS, toCompany),
        createCompany: (draft) => insert('companies', COMPANY_FIELDS, toRow(companyColumns, draft), toCompany),
        updateCompany: (id, changes) => update('companies', COMPANY_FIELDS, id, toRow(companyColumns, changes), toCompany),
        listSites: () => list('sites', SITE_FIELDS, toSite),
        createSite: (draft) => insert('sites', SITE_FIELDS, toRow(siteColumns, draft), toSite),
        updateSite: (id, changes) => update('sites', SITE_FIELDS, id, toRow(siteColumns, changes), toSite),
        listPartners: () => list('partners', PARTNER_FIELDS, toPartner),
        createPartner: async (draft) => insert('partners', PARTNER_FIELDS, toRow(partnerColumns, normalizePartnerValues(draft)), toPartner),
        updatePartner,
        listItems: () => list('items', ITEM_FIELDS, toItem),
        // async so a synchronous validation failure surfaces as a rejection like every other method.
        createItem: async (draft) => insert('items', ITEM_FIELDS, toRow(itemColumns, normalizeItemValues(draft)), toItem),
        updateItem,
        listWarehouses: () => list('warehouses', WAREHOUSE_FIELDS, toWarehouse),
        createWarehouse: async (draft) => insert('warehouses', WAREHOUSE_FIELDS, toRow(warehouseColumns, normalizeWarehouseValues(draft)), toWarehouse),
        updateWarehouse,
        listAccounts: () => list('accounts', ACCOUNT_FIELDS, toAccount),
        createAccount: async (draft) => insert('accounts', ACCOUNT_FIELDS, toRow(accountColumns, normalizeAccountValues(draft)), toAccount),
        updateAccount
    };
}
