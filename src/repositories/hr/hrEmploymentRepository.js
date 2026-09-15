import { getSupabaseClient } from '@/lib/supabase/client';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableUuid = (value) => value === null || uuid(value);
const text = (value) => typeof value === 'string';
const date = (value) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nullableDate = (value) => value === null || date(value);
const previewSources = ['direct', 'grade', 'position', 'unlinked', 'unmapped', 'not_member', 'unpublished'];
const preview = (row) => row && (row.level === null || [1, 2, 3, 4, 5].includes(row.level)) && previewSources.includes(row.source);
const action = (row) =>
    row && uuid(row.id) && ['transfer', 'terminate'].includes(row.type) && date(row.effectiveDate) && nullableUuid(row.siteId) && ['department', 'grade', 'position', 'reason'].every((key) => text(row[key])) && typeof row.cancelled === 'boolean';
const employment = (row) =>
    row &&
    uuid(row.id) &&
    Number.isSafeInteger(row.sequenceNo) &&
    row.sequenceNo > 0 &&
    date(row.hireDate) &&
    nullableDate(row.endDate) &&
    ['planned', 'active', 'terminated', 'cancelled'].includes(row.status) &&
    nullableUuid(row.siteId) &&
    ['department', 'grade', 'position'].every((key) => text(row[key])) &&
    typeof row.cancelled === 'boolean' &&
    (row.cancellationReason === null || text(row.cancellationReason)) &&
    (!row.cancelled || text(row.cancellationReason)) &&
    typeof row.accountChanged === 'boolean' &&
    Array.isArray(row.actions) &&
    row.actions.every(action);
const historyValid = (data, company, employeeId) => {
    if (
        !data ||
        data.companyId !== company ||
        data.employeeId !== employeeId ||
        !Number.isSafeInteger(data.employeeRevision) ||
        data.employeeRevision < 1 ||
        typeof data.permissions?.create !== 'boolean' ||
        typeof data.permissions?.cancel !== 'boolean' ||
        !Array.isArray(data.employments) ||
        !data.employments.every(employment)
    )
        return false;
    return new Set(data.employments.map((row) => row.id)).size === data.employments.length && new Set(data.employments.map((row) => row.sequenceNo)).size === data.employments.length;
};
const namedId = (row) => row && uuid(row.id) && text(row.name);
const reference = (row) => namedId(row) && ['department', 'grade', 'position'].includes(row.kind) && text(row.code);
const candidate = (row) => namedId(row) && preview(row.preview);
const mapping = (row) => row && ['grade', 'position'].includes(row.kind) && text(row.code) && [1, 2, 3, 4, 5].includes(row.level) && nullableDate(row.from) && nullableDate(row.to);
const preparationValid = (data, company, employeeId) =>
    data &&
    data.companyId === company &&
    data.employeeId === employeeId &&
    Number.isSafeInteger(data.employeeRevision) &&
    data.employeeRevision >= 1 &&
    typeof data.eligible === 'boolean' &&
    nullableDate(data.earliestHireDate) &&
    (!data.eligible || date(data.earliestHireDate)) &&
    (data.currentAccount === null || namedId(data.currentAccount)) &&
    Array.isArray(data.accountCandidates) &&
    data.accountCandidates.every(candidate) &&
    Array.isArray(data.sites) &&
    data.sites.every(namedId) &&
    Array.isArray(data.references) &&
    data.references.every(reference) &&
    Array.isArray(data.mappings) &&
    data.mappings.every(mapping) &&
    typeof data.permissions?.create === 'boolean';

export const hrEmploymentErrorMessage = (code) =>
    ({
        revision_conflict: '다른 작업에서 직원 정보가 변경되었습니다. 최신 정보를 다시 불러와 주세요.',
        rehire_not_allowed: '퇴사 처리된 최신 고용 회차가 있어야 재입사를 등록할 수 있습니다.',
        employment_overlap: '재입사일은 이전 퇴사일 다음 날 이후여야 합니다.',
        account_unavailable: '선택한 계정을 연결할 수 없습니다. 회사 정책과 기존 연결을 확인해 주세요.',
        invalid_employment: '재입사 날짜, 소속, 계정 처리와 변경 사유를 확인해 주세요.',
        planned_employment_required: '취소할 수 있는 최신 재입사 예정 회차가 아닙니다.',
        access_denied: '고용 이력을 처리할 권한이 없거나 인사 모듈 상태가 변경되었습니다.'
    })[code] || '고용 이력을 처리하지 못했습니다. 권한과 입력 내용을 확인하고 다시 시도해 주세요.';

export function createHrEmploymentRepository(client = getSupabaseClient()) {
    const request = async (name, params, validate) => {
        try {
            if (!uuid(params.target_company) || !uuid(params.target_employee) || ('target_employment' in params && !uuid(params.target_employment))) throw new Error();
            const response = await client.rpc(name, params);
            if (!response || response.error) throw response?.error;
            if (!validate(response.data)) throw new Error();
            return response.data;
        } catch (cause) {
            const trusted = ['rehire_not_allowed', 'employment_overlap', 'account_unavailable', 'invalid_employment', 'planned_employment_required'];
            const code = cause?.code === '40001' ? 'revision_conflict' : cause?.code === '42501' ? 'access_denied' : cause?.code === '22023' && trusted.includes(cause.message) ? cause.message : 'hr_employment_request_failed';
            const error = new Error(hrEmploymentErrorMessage(code));
            error.code = code;
            throw error;
        }
    };
    return {
        loadHistory: (companyId, employeeId) => request('hr_employment_history', { target_company: companyId, target_employee: employeeId }, (data) => historyValid(data, companyId, employeeId)),
        prepareRehire: (companyId, employeeId) => request('hr_prepare_rehire', { target_company: companyId, target_employee: employeeId }, (data) => preparationValid(data, companyId, employeeId)),
        createReemployment: (companyId, employeeId, revision, document, reason) =>
            request('hr_create_reemployment', { target_company: companyId, target_employee: employeeId, expected_revision: revision, employment_document: document, change_reason: reason }, (data) => historyValid(data, companyId, employeeId)),
        cancelPlanned: (companyId, employeeId, employmentId, revision, reason) =>
            request('hr_cancel_planned_employment', { target_company: companyId, target_employee: employeeId, target_employment: employmentId, expected_revision: revision, change_reason: reason }, (data) => historyValid(data, companyId, employeeId))
    };
}
