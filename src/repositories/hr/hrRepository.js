import { getSupabaseClient } from '@/lib/supabase/client';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableUuid = (value) => value === null || uuid(value);
const text = (value) => typeof value === 'string';
const date = (value) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const assignment = (row) => nullableUuid(row.siteId) && ['department', 'grade', 'position'].every((key) => text(row[key]));
const action = (row) => row && uuid(row.id) && ['transfer', 'terminate'].includes(row.type) && date(row.effectiveDate) && assignment(row) && text(row.reason) && typeof row.cancelled === 'boolean';
const employee = (row, company) =>
    row &&
    uuid(row.id) &&
    row.companyId === company &&
    text(row.employeeNo) &&
    row.employeeNo.trim() &&
    text(row.name) &&
    row.name.trim() &&
    nullableUuid(row.profileId) &&
    date(row.hireDate) &&
    assignment(row) &&
    ['planned', 'active', 'terminated'].includes(row.status) &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 1 &&
    Array.isArray(row.actions) &&
    row.actions.every(action);
const validDirectory = (data, company) =>
    data &&
    Array.isArray(data.employees) &&
    data.employees.length <= 25 &&
    data.employees.every((row) => employee(row, company)) &&
    Number.isSafeInteger(data.total) &&
    data.total >= data.employees.length &&
    Number.isSafeInteger(data.page) &&
    data.page >= 1 &&
    data.pageSize === 25 &&
    typeof data.permissions?.create === 'boolean' &&
    typeof data.permissions?.update === 'boolean' &&
    Array.isArray(data.accounts) &&
    data.accounts.every((account) => account && uuid(account.id) && text(account.name)) &&
    Array.isArray(data.sites) &&
    data.sites.every((site) => site && uuid(site.id) && text(site.name));

const failure = (source) => {
    const conflict = source?.code === '40001' || source?.code === 'revision_conflict';
    const error = new Error(conflict ? '다른 작업에서 인사 정보가 변경되었습니다. 최신 정보를 불러와 주세요.' : '인사 정보를 처리하지 못했습니다. 권한과 입력 내용을 확인하고 다시 시도해 주세요.');
    error.code = conflict ? 'revision_conflict' : 'hr_request_failed';
    return error;
};

export function createHrRepository(client = getSupabaseClient()) {
    const request = async (name, params, validate) => {
        try {
            if (!uuid(params.target_company)) throw new Error();
            const response = await client.rpc(name, params);
            if (!response || response.error) throw response?.error;
            if (!validate(response.data)) throw new Error();
            return response.data;
        } catch (cause) {
            throw failure(cause);
        }
    };
    return {
        loadDirectory: (companyId, search = '', page = 1) => request('hr_directory', { target_company: companyId, search_text: search, page_number: page }, (data) => validDirectory(data, companyId)),
        createEmployee: (companyId, document, reason) => request('hr_create_employee', { target_company: companyId, employee_document: document, change_reason: reason }, uuid),
        recordAction: (companyId, employeeId, revision, document) => request('hr_record_personnel_action', { target_company: companyId, target_employee: employeeId, expected_revision: revision, action_document: document }, uuid),
        cancelAction: (companyId, employeeId, actionId, revision, reason) =>
            request('hr_cancel_personnel_action', { target_company: companyId, target_employee: employeeId, target_action: actionId, expected_revision: revision, change_reason: reason }, (data) => data === null)
    };
}
