import { getSupabaseClient } from '@/lib/supabase/client';

export class EnterpriseRuntimeRepositoryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'EnterpriseRuntimeRepositoryError';
        this.code = code;
    }
}

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const strings = (value) => Array.isArray(value) && value.every(text);
const companiesValid = (value) => Array.isArray(value) && value.every((row) => row && text(row.id) && text(row.name)) && new Set(value.map((row) => row.id)).size === value.length;
const actionsValid = (value) => strings(value) && value.every((action) => ['read', 'create', 'update'].includes(action));
const invalid = () => {
    throw new EnterpriseRuntimeRepositoryError('invalid_runtime_response', '권한 응답을 확인할 수 없습니다. 다시 시도해 주세요.');
};

export function validateEnterpriseRuntimeContext(row) {
    if (!row || !['legacy', 'active'].includes(row.mode) || !companiesValid(row.companies) || !strings(row.menuKeys) || !revision(row.revision)) return invalid();
    if (row.companyId !== null && (!text(row.companyId) || !row.companies.some((company) => company.id === row.companyId))) return invalid();
    const hiddenMenuKeys = row.hiddenMenuKeys === undefined ? [] : row.hiddenMenuKeys;
    if (!strings(hiddenMenuKeys) || new Set(hiddenMenuKeys).size !== hiddenMenuKeys.length || !hiddenMenuKeys.every((key) => row.menuKeys.includes(key))) return invalid();
    const companyActions = row.companyActions ?? (row.mode === 'legacy' ? [] : undefined);
    const siteActions = row.siteActions ?? (row.mode === 'legacy' ? [] : undefined);
    if (!actionsValid(companyActions) || !Array.isArray(siteActions) || !siteActions.every((site) => site && text(site.id) && actionsValid(site.actions))) return invalid();
    if (row.mode === 'legacy' && (row.menuKeys.length || companyActions.length || siteActions.length || row.revision !== 0)) return invalid();
    if (row.companyId === null && (row.menuKeys.length || companyActions.length || siteActions.length)) return invalid();
    return {
        mode: row.mode,
        companyId: row.companyId,
        companies: row.companies.map(({ id, name }) => ({ id, name })),
        menuKeys: [...row.menuKeys],
        hiddenMenuKeys: [...hiddenMenuKeys],
        revision: row.revision,
        companyActions: [...companyActions],
        siteActions: siteActions.map(({ id, actions }) => ({ id, actions: [...actions] }))
    };
}

const publication = (row) => {
    if (!row || !revision(row.revision) || !(row.draftRevision === null || revision(row.draftRevision)) || typeof row.active !== 'boolean') return invalid();
    return { revision: row.revision, draftRevision: row.draftRevision, active: row.active };
};

export function createEnterpriseRuntimeRepository(client = getSupabaseClient()) {
    const run = async (name, args, validate) => {
        try {
            if (!client) throw new Error('Not configured');
            const { data, error } = await client.rpc(name, args);
            if (error) throw error;
            return validate(data);
        } catch (error) {
            const messages = { 40001: ['revision_conflict', '게시 상태가 변경되었습니다. 최신 상태를 다시 불러와 주세요.'], 42501: ['access_denied', '이 작업에 필요한 권한 또는 2단계 인증을 확인해 주세요.'] };
            throw new EnterpriseRuntimeRepositoryError(...(messages[error?.code] || ['runtime_request_failed', '권한 정보를 불러오지 못했습니다. 다시 시도해 주세요.']));
        }
    };
    return {
        loadContext: (companyId = null) => run('enterprise_access_context', { target_company: companyId }, validateEnterpriseRuntimeContext),
        loadPublication: (companyId) => run('enterprise_access_publication', { target_company: companyId }, publication),
        publish: (companyId, draftRevision, expectedRevision, reason) => run('enterprise_publish_access_policy', { target_company: companyId, draft_revision: draftRevision, expected_revision: expectedRevision, change_reason: reason }, publication),
        revert: (companyId, expectedRevision, reason) => run('enterprise_revert_access_policy', { target_company: companyId, expected_revision: expectedRevision, change_reason: reason }, publication),
        listAdminCompanies: () => run('enterprise_access_companies', {}, (rows) => (companiesValid(rows) ? rows.map(({ id, name }) => ({ id, name })) : invalid())),
        listAdminSites: (companyId) =>
            run('enterprise_access_sites', { target_company: companyId }, (rows) =>
                companiesValid(rows) && rows.every((row) => row.companyId === companyId) ? rows.map(({ id, name, companyId: owner }) => ({ id, name, companyId: owner })) : invalid()
            )
    };
}
