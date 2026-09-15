import { getSupabaseClient } from '@/lib/supabase/client';
import { createDemoAuditRepository } from './demoAuditRepository';
import { createSupabaseAuditRepository } from './supabaseAuditRepository';

// The ledger is read-only by design: history is written by database triggers, never by a client.
export const AUDIT_REPOSITORY_METHODS = Object.freeze(['listAuditLogs']);

export function assertAuditRepository(repository) {
    if (!repository || AUDIT_REPOSITORY_METHODS.some((method) => typeof repository[method] !== 'function')) {
        throw new TypeError(`Audit repository must implement ${AUDIT_REPOSITORY_METHODS.join(', ')}.`);
    }
    return repository;
}

// Supabase when the browser is configured for it; the in-memory demo otherwise (local UI work, tests).
export function createDefaultAuditRepository({ client = getSupabaseClient() } = {}) {
    return client ? createSupabaseAuditRepository(client) : createDemoAuditRepository();
}
