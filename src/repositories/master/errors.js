export const MASTER_ERROR_MESSAGES = Object.freeze({
    master_load_failed: '기준정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    master_save_failed: '기준정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    master_not_configured: 'Supabase 연결 정보가 설정되지 않았습니다.',
    duplicate_code: '이미 사용 중인 코드 또는 사업자등록번호입니다.',
    invalid_value: '입력 값의 형식이 올바르지 않습니다.',
    company_inactive: '비활성 회사에는 활성 사업장을 둘 수 없습니다.',
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
