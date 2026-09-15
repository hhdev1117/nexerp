import { getSupabaseClient } from '@/lib/supabase/client';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
const nullable = (value, predicate) => value === null || predicate(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const rowValid = (row) =>
    exact(row, ['id', 'employmentId', 'employmentSequence', 'siteId', 'department', 'grade', 'position', 'startDate', 'endDate', 'status', 'reason', 'endReason', 'cancellationReason', 'revision']) &&
    uuid(row.id) &&
    uuid(row.employmentId) &&
    Number.isSafeInteger(row.employmentSequence) &&
    uuid(row.siteId) &&
    ['department', 'grade', 'position', 'reason'].every((k) => typeof row[k] === 'string') &&
    date(row.startDate) &&
    nullable(row.endDate, date) &&
    ['planned', 'active', 'ended', 'cancelled'].includes(row.status) &&
    nullable(row.endReason, (v) => typeof v === 'string') &&
    nullable(row.cancellationReason, (v) => typeof v === 'string') &&
    Number.isSafeInteger(row.revision);
const historyValid = (data, companyId, employeeId) =>
    exact(data, ['companyId', 'employeeId', 'employeeRevision', 'permissions', 'assignments']) &&
    data.companyId === companyId &&
    data.employeeId === employeeId &&
    Number.isSafeInteger(data.employeeRevision) &&
    exact(data.permissions, ['create', 'end', 'cancel']) &&
    Object.values(data.permissions).every((v) => typeof v === 'boolean') &&
    Array.isArray(data.assignments) &&
    data.assignments.every(rowValid) &&
    new Set(data.assignments.map((row) => row.id)).size === data.assignments.length;

export const hrSecondaryAssignmentErrorMessage = (code) =>
    ({
        revision_conflict: '다른 작업에서 직원 또는 겸직 정보가 변경되었습니다. 최신 정보를 다시 불러와 주세요.',
        secondary_overlap: '같은 부서의 겸직 기간이 기존 겸직과 겹칩니다.',
        primary_assignment_conflict: '주 소속 부서와 같은 부서를 겸직으로 지정할 수 없습니다.',
        employment_bounds: '겸직 기간은 선택한 고용 회차 안에 있어야 합니다.',
        planned_assignment_required: '시작 전인 겸직 예정만 취소할 수 있습니다.',
        access_denied: '겸직을 처리할 권한이 없거나 인사 모듈 상태가 변경되었습니다.',
        module_not_writable: '현재 인사 모듈에서는 겸직을 변경할 수 없습니다.'
    })[code] || '겸직 정보를 처리하지 못했습니다. 입력 내용과 권한을 확인해 주세요.';

export function createHrSecondaryAssignmentRepository(client = getSupabaseClient()) {
    const request = async (name, params, validate) => {
        try {
            if (!uuid(params.target_company) || !uuid(params.target_employee) || ('target_assignment' in params && !uuid(params.target_assignment))) throw new Error();
            const response = await client.rpc(name, params);
            if (!response || response.error) throw response?.error;
            if (!validate(response.data)) throw new Error();
            return response.data;
        } catch (cause) {
            const trusted = ['secondary_overlap', 'primary_assignment_conflict', 'employment_bounds', 'planned_assignment_required', 'module_not_writable'];
            const code = cause?.code === '40001' ? 'revision_conflict' : cause?.code === '42501' ? 'access_denied' : cause?.code === '22023' && trusted.includes(cause.message) ? cause.message : 'hr_secondary_request_failed';
            const error = new Error(hrSecondaryAssignmentErrorMessage(code));
            error.code = code;
            throw error;
        }
    };
    return {
        loadHistory: (companyId, employeeId) => request('hr_secondary_assignment_history', { target_company: companyId, target_employee: employeeId }, (d) => historyValid(d, companyId, employeeId)),
        prepare: async (companyId, employeeId) =>
            request(
                'hr_prepare_secondary_assignment',
                { target_company: companyId, target_employee: employeeId },
                (d) =>
                    d?.companyId === companyId &&
                    d?.employeeId === employeeId &&
                    Number.isSafeInteger(d.employeeRevision) &&
                    Array.isArray(d.employmentCycles) &&
                    Array.isArray(d.sites) &&
                    Array.isArray(d.references) &&
                    Array.isArray(d.mappings) &&
                    typeof d.permissions?.create === 'boolean'
            ),
        create: (companyId, employeeId, revision, document, reason) =>
            request('hr_create_secondary_assignment', { target_company: companyId, target_employee: employeeId, expected_employee_revision: revision, assignment_document: document, change_reason: reason.trim() }, (d) =>
                historyValid(d, companyId, employeeId)
            ),
        end: (companyId, employeeId, assignmentId, employeeRevision, assignmentRevision, endDate, reason) =>
            request(
                'hr_end_secondary_assignment',
                {
                    target_company: companyId,
                    target_employee: employeeId,
                    target_assignment: assignmentId,
                    expected_employee_revision: employeeRevision,
                    expected_assignment_revision: assignmentRevision,
                    new_end_date: endDate,
                    change_reason: reason.trim()
                },
                (d) => historyValid(d, companyId, employeeId)
            ),
        cancel: (companyId, employeeId, assignmentId, employeeRevision, assignmentRevision, reason) =>
            request(
                'hr_cancel_secondary_assignment',
                { target_company: companyId, target_employee: employeeId, target_assignment: assignmentId, expected_employee_revision: employeeRevision, expected_assignment_revision: assignmentRevision, change_reason: reason.trim() },
                (d) => historyValid(d, companyId, employeeId)
            )
    };
}
