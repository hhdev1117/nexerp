export const MASTER_ERROR_MESSAGES = Object.freeze({
    master_load_failed: '기준정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    master_save_failed: '기준정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    master_not_configured: 'Supabase 연결 정보가 설정되지 않았습니다.',
    duplicate_code: '이미 사용 중인 코드입니다.',
    duplicate_business_number: '이미 사용 중인 사업자등록번호입니다.',
    invalid_value: '입력 값의 형식이 올바르지 않습니다.',
    company_inactive: '비활성 회사에는 활성 사업장 또는 거래처를 둘 수 없습니다.',
    site_inactive: '비활성 사업장에는 활성 창고를 둘 수 없습니다.',
    site_company_mismatch: '선택한 사업장이 해당 회사 소속이 아닙니다.',
    site_not_found: '사업장을 찾을 수 없습니다.',
    parent_not_found: '상위 계정을 찾을 수 없습니다.',
    parent_company_mismatch: '상위 계정이 같은 회사 소속이어야 합니다.',
    parent_type_mismatch: '상위 계정과 계정 유형이 같아야 합니다.',
    parent_is_postable: '전표 입력이 가능한 계정 아래에는 하위 계정을 둘 수 없습니다.',
    parent_inactive: '상위 계정이 비활성이면 하위 계정을 활성화할 수 없습니다.',
    invalid_parent: '상위 계정 관계가 올바르지 않습니다. 자기 자신이나 하위 계정은 상위로 지정할 수 없습니다.',
    admin_required: '관리자 권한이 필요합니다.',
    not_found: '대상을 찾을 수 없습니다.'
});

export class MasterRepositoryError extends Error {
    constructor(code, message = MASTER_ERROR_MESSAGES[code] || MASTER_ERROR_MESSAGES.master_save_failed) {
        super(message);
        this.name = 'MasterRepositoryError';
        this.code = code;
    }
}

export const masterError = (code) => new MasterRepositoryError(code);
