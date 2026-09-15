export const AUDIT_ERROR_MESSAGES = Object.freeze({
    audit_load_failed: '감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    audit_not_configured: 'Supabase 연결 정보가 설정되지 않았습니다.',
    admin_required: '감사 로그는 관리자만 조회할 수 있습니다.'
});

export class AuditRepositoryError extends Error {
    constructor(code, message = AUDIT_ERROR_MESSAGES[code] || AUDIT_ERROR_MESSAGES.audit_load_failed) {
        super(message);
        this.name = 'AuditRepositoryError';
        this.code = code;
    }
}

export const auditError = (code) => new AuditRepositoryError(code);
