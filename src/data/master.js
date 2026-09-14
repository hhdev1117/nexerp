// Company and site (사업장) master-data rules shared by screens, stores, and repositories.

export const SITE_TYPE = Object.freeze({
    HEAD_OFFICE: 'head_office',
    FACTORY: 'factory',
    WAREHOUSE: 'warehouse',
    BRANCH: 'branch',
    OTHER: 'other'
});

const siteTypeLabels = Object.freeze({
    head_office: '본사',
    factory: '공장',
    warehouse: '물류센터',
    branch: '지점',
    other: '기타'
});

export const siteTypeOptions = Object.freeze(Object.entries(siteTypeLabels).map(([value, label]) => Object.freeze({ value, label })));

export function siteTypeLabel(code) {
    return siteTypeLabels[code] ?? (typeof code === 'string' ? code : '');
}

// Mirrors the database check constraints so users see the problem before a round trip.
export const MASTER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const BUSINESS_NUMBER_PATTERN = /^\d{10}$/;

export const MASTER_MESSAGES = Object.freeze({
    code: '코드는 영문 대문자, 숫자, 하이픈으로 2자 이상 20자 이하여야 합니다.',
    companyName: '회사명을 입력해 주세요.',
    businessNumber: '사업자등록번호는 숫자 10자리여야 합니다.',
    company: '회사를 선택해 주세요.',
    siteName: '사업장명을 입력해 주세요.',
    siteType: '사업장 유형을 선택해 주세요.'
});

export const normalizeCode = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');
export const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

export function normalizeBusinessNumber(value) {
    const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
    return digits || null;
}

export function formatBusinessNumber(value) {
    const digits = normalizeBusinessNumber(value);
    if (!digits) return '';
    return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}

export function createCompanyDraft(company = null) {
    return {
        code: company?.code ?? '',
        name: company?.name ?? '',
        businessNumber: company?.businessNumber ? formatBusinessNumber(company.businessNumber) : '',
        representative: company?.representative ?? '',
        address: company?.address ?? '',
        isActive: company ? company.isActive === true : true
    };
}

export function validateCompanyDraft(draft) {
    const errors = {};
    if (!MASTER_CODE_PATTERN.test(normalizeCode(draft?.code))) errors.code = MASTER_MESSAGES.code;
    if (!normalizeText(draft?.name)) errors.name = MASTER_MESSAGES.companyName;
    const businessNumber = normalizeBusinessNumber(draft?.businessNumber);
    if (businessNumber && !BUSINESS_NUMBER_PATTERN.test(businessNumber)) errors.businessNumber = MASTER_MESSAGES.businessNumber;
    return errors;
}

export function companyPayload(draft) {
    return {
        code: normalizeCode(draft.code),
        name: normalizeText(draft.name),
        businessNumber: normalizeBusinessNumber(draft.businessNumber),
        representative: normalizeText(draft.representative),
        address: normalizeText(draft.address),
        isActive: draft.isActive === true
    };
}

export function createSiteDraft(site = null, companyId = '') {
    return {
        companyId: site?.companyId ?? companyId ?? '',
        code: site?.code ?? '',
        name: site?.name ?? '',
        siteType: site?.siteType ?? SITE_TYPE.OTHER,
        address: site?.address ?? '',
        isActive: site ? site.isActive === true : true
    };
}

export function validateSiteDraft(draft) {
    const errors = {};
    if (!normalizeText(draft?.companyId)) errors.companyId = MASTER_MESSAGES.company;
    if (!MASTER_CODE_PATTERN.test(normalizeCode(draft?.code))) errors.code = MASTER_MESSAGES.code;
    if (!normalizeText(draft?.name)) errors.name = MASTER_MESSAGES.siteName;
    if (!Object.hasOwn(siteTypeLabels, draft?.siteType)) errors.siteType = MASTER_MESSAGES.siteType;
    return errors;
}

export function sitePayload(draft) {
    return {
        companyId: normalizeText(draft.companyId),
        code: normalizeCode(draft.code),
        name: normalizeText(draft.name),
        siteType: draft.siteType,
        address: normalizeText(draft.address),
        isActive: draft.isActive === true
    };
}
