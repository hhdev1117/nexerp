import { getSupabaseClient } from '@/lib/supabase/client';
import { createDemoMasterRepository } from './demoMasterRepository';
import { createSupabaseMasterRepository } from './supabaseMasterRepository';

// Master-data sources implement this asynchronous contract. Records are deactivated, never deleted.
export const MASTER_REPOSITORY_METHODS = Object.freeze([
    'listCompanies',
    'createCompany',
    'updateCompany',
    'listSites',
    'createSite',
    'updateSite',
    'listPartners',
    'createPartner',
    'updatePartner',
    'listItems',
    'createItem',
    'updateItem',
    'listWarehouses',
    'createWarehouse',
    'updateWarehouse',
    'listAccounts',
    'createAccount',
    'updateAccount'
]);

const describeMethods = (methods) => `${methods.slice(0, -1).join(', ')}, and ${methods.at(-1)}`;

export function assertMasterRepository(repository) {
    if (!repository || MASTER_REPOSITORY_METHODS.some((method) => typeof repository[method] !== 'function')) {
        throw new TypeError(`Master repository must implement ${describeMethods(MASTER_REPOSITORY_METHODS)}.`);
    }
    return repository;
}

// Supabase when the browser is configured for it; the in-memory demo otherwise (local UI work, tests).
export function createDefaultMasterRepository({ client = getSupabaseClient() } = {}) {
    return client ? createSupabaseMasterRepository(client) : createDemoMasterRepository();
}
