import { getSupabaseClient } from '@/lib/supabase/client';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableUuid = (value) => value === null || uuid(value);
const text = (value) => typeof value === 'string';
const sources = ['direct', 'grade', 'position', 'unlinked', 'unmapped', 'not_member', 'unpublished'];
const preview = (row) => row && (row.level === null || [1, 2, 3, 4, 5].includes(row.level)) && sources.includes(row.source);
const candidate = (row) => row && uuid(row.id) && text(row.name) && preview(row.preview);
const account = (row) => row === null || (candidate(row) && typeof row.listed === 'boolean');
const optionsValid = (data, company, employee) =>
    data &&
    data.companyId === company &&
    data.employeeId === employee &&
    text(data.employeeNo) &&
    text(data.name) &&
    Number.isSafeInteger(data.revision) &&
    data.revision >= 1 &&
    ['planned', 'active', 'terminated'].includes(data.status) &&
    text(data.grade) &&
    text(data.position) &&
    account(data.account) &&
    Array.isArray(data.candidates) &&
    data.candidates.every(candidate) &&
    typeof data.permissions?.link === 'boolean' &&
    typeof data.permissions?.unlink === 'boolean';
const entry = (row) =>
    row &&
    uuid(row.id) &&
    nullableUuid(row.beforeAccountId) &&
    nullableUuid(row.afterAccountId) &&
    text(row.beforeAccountName) &&
    text(row.afterAccountName) &&
    text(row.reason) &&
    text(row.createdAt) &&
    Number.isFinite(Date.parse(row.createdAt));

export const hrAccountErrorMessage = (code) =>
    ({
        revision_conflict: '다른 작업에서 직원 정보가 변경되었습니다. 최신 정보를 불러와 주세요.',
        account_unavailable: '선택한 계정을 연결할 수 없습니다. 이미 다른 직원에게 연결되었거나 회사 권한이 없는 계정입니다.',
        account_link_unchanged: '현재 연결 상태와 같습니다. 다른 계정을 선택하거나 연결을 해제해 주세요.',
        employee_terminated: '퇴사한 직원에게는 새 계정을 연결할 수 없습니다. 연결 해제만 가능합니다.',
        invalid_account_link: '변경 사유를 1~2000자로 입력해 주세요.',
        access_denied: '계정 연결을 변경할 권한이 없거나 인사 모듈이 중지되었습니다.'
    })[code] || '계정 연결을 처리하지 못했습니다. 권한과 입력 내용을 확인하고 다시 시도해 주세요.';

export function createHrAccountRepository(client = getSupabaseClient()) {
    const request = async (name, params, validate) => {
        try {
            if (!uuid(params.target_company) || !uuid(params.target_employee)) throw new Error();
            const response = await client.rpc(name, params);
            if (!response || response.error) throw response?.error;
            if (!validate(response.data)) throw new Error();
            return response.data;
        } catch (cause) {
            const trusted = ['account_unavailable', 'account_link_unchanged', 'employee_terminated', 'invalid_account_link'];
            const code = cause?.code === '40001' ? 'revision_conflict' : cause?.code === '42501' ? 'access_denied' : cause?.code === '22023' && trusted.includes(cause.message) ? cause.message : 'hr_account_request_failed';
            const error = new Error(hrAccountErrorMessage(code));
            error.code = code;
            throw error;
        }
    };
    return {
        loadOptions: (companyId, employeeId) => request('hr_account_link_options', { target_company: companyId, target_employee: employeeId }, (data) => optionsValid(data, companyId, employeeId)),
        loadHistory: (companyId, employeeId) => request('hr_account_link_history', { target_company: companyId, target_employee: employeeId }, (data) => Array.isArray(data) && data.every(entry)),
        linkAccount: (companyId, employeeId, revision, profileId, reason) =>
            request(
                'hr_link_employee_account',
                { target_company: companyId, target_employee: employeeId, expected_revision: revision, target_profile: profileId, change_reason: reason },
                (data) => optionsValid(data, companyId, employeeId)
            )
    };
}
