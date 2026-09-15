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
    (data.permissions.cancel === undefined || typeof data.permissions.cancel === 'boolean') &&
    (data.moduleState === undefined || ['enabled', 'draining', 'read_only', 'disabled'].includes(data.moduleState)) &&
    Array.isArray(data.accounts) &&
    data.accounts.every((account) => account && uuid(account.id) && text(account.name)) &&
    Array.isArray(data.sites) &&
    data.sites.every((site) => site && uuid(site.id) && text(site.name));

const failure = (source) => {
    const trusted = ['reference_in_use', 'invalid_parent', 'immutable_reference', 'invalid_correction_date', 'invalid_correction', 'future_employment_exists'];
    const code = source?.code === '40001' || source?.code === 'revision_conflict' ? 'revision_conflict' : source?.code === '22023' && trusted.includes(source.message) ? source.message : 'hr_request_failed';
    const error = new Error(hrErrorMessage(code));
    error.code = code;
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
        loadReferences: (companyId) => request('hr_reference_catalog', { target_company: companyId }, (data) => data && Array.isArray(data.items) && data.items.every((row) => reference(row, companyId)) && typeof data.canManage === 'boolean'),
        saveReference: (companyId, document, revision, reason) => request('hr_save_reference', { target_company: companyId, reference_document: document, expected_revision: revision, change_reason: reason }, uuid),
        correctEmployee: (companyId, employeeId, revision, document, reason) =>
            request('hr_correct_employee', { target_company: companyId, target_employee: employeeId, expected_revision: revision, correction_document: document, change_reason: reason }, (data) => data === null),
        loadCorrections: (companyId, employeeId) => request('hr_employee_corrections', { target_company: companyId, target_employee: employeeId }, (data) => Array.isArray(data) && data.every(correction)),
        loadDirectory: async (companyId, search = '', page = 1) => {
            const data = await request('hr_directory', { target_company: companyId, search_text: search, page_number: page }, (data) => validDirectory(data, companyId));
            return { ...data, moduleState: data.moduleState ?? 'enabled', permissions: { ...data.permissions, cancel: data.permissions.cancel ?? false } };
        },
        createEmployee: (companyId, document, reason) => request('hr_create_employee', { target_company: companyId, employee_document: document, change_reason: reason }, uuid),
        recordAction: (companyId, employeeId, revision, document) => request('hr_record_personnel_action', { target_company: companyId, target_employee: employeeId, expected_revision: revision, action_document: document }, uuid),
        cancelAction: (companyId, employeeId, actionId, revision, reason) =>
            request('hr_cancel_personnel_action', { target_company: companyId, target_employee: employeeId, target_action: actionId, expected_revision: revision, change_reason: reason }, (data) => data === null)
    };
}
const boundedText = (value, max = 150) => text(value) && value.trim().length > 0 && value.length <= max;
const referenceCode = (value) => text(value) && value.length > 0 && value.length <= 150;
const reference = (row, company) =>
    row &&
    uuid(row.id) &&
    row.companyId === company &&
    ['department', 'grade', 'position'].includes(row.kind) &&
    referenceCode(row.code) &&
    boundedText(row.name) &&
    (row.parentCode === null || (row.kind === 'department' && referenceCode(row.parentCode))) &&
    typeof row.isActive === 'boolean' &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 1;
const correctionDocument = (row) => row && boundedText(row.name) && date(row.hireDate);
const correction = (row) =>
    row && uuid(row.id) && correctionDocument(row.before) && correctionDocument(row.after) && boundedText(row.reason, 2000) && text(row.createdAt) && /^\d{4}-\d{2}-\d{2}T/.test(row.createdAt) && Number.isFinite(Date.parse(row.createdAt));

export const hrErrorMessage = (code) =>
    ({
        revision_conflict: '다른 작업에서 인사 정보가 변경되었습니다. 최신 정보를 불러와 주세요.',
        reference_in_use: '현재 또는 예정된 직원·발령에서 사용 중이거나 활성 하위 부서가 있어 비활성화할 수 없습니다.',
        invalid_parent: '상위 부서를 확인해 주세요. 비활성 부서나 순환 관계는 지정할 수 없습니다.',
        immutable_reference: '등록된 코드와 종류는 변경할 수 없습니다.',
        invalid_correction_date: '입사일은 취소된 이력을 포함한 기존 발령일보다 늦을 수 없습니다.',
        invalid_correction: '이름과 변경 사유를 확인해 주세요. 입사일은 고용 이력에서 관리합니다.',
        future_employment_exists: '예정된 재입사 회차를 먼저 취소한 뒤 퇴사 발령을 취소해 주세요.'
    })[code] || '인사 정보를 처리하지 못했습니다. 권한과 입력 내용을 확인하고 다시 시도해 주세요.';
