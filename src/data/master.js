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

export const ITEM_TYPE = Object.freeze({
    RAW_MATERIAL: 'raw_material',
    SEMI_FINISHED: 'semi_finished',
    FINISHED_GOOD: 'finished_good',
    CONSUMABLE: 'consumable',
    SERVICE: 'service'
});

const itemTypeLabels = Object.freeze({
    raw_material: '원자재',
    semi_finished: '반제품',
    finished_good: '완제품',
    consumable: '부자재',
    service: '용역'
});

export const itemTypeOptions = Object.freeze(Object.entries(itemTypeLabels).map(([value, label]) => Object.freeze({ value, label })));

export function itemTypeLabel(code) {
    return itemTypeLabels[code] ?? (typeof code === 'string' ? code : '');
}

// Common stock-keeping units. The database accepts any short upper-case code.
export const ITEM_UNITS = Object.freeze(['EA', 'BOX', 'SET', 'KG', 'G', 'TON', 'M', 'CM', 'MM', 'L', 'ML', 'ROLL', 'HR']);
export const itemUnitOptions = Object.freeze(ITEM_UNITS.map((value) => Object.freeze({ value, label: value })));

export const WAREHOUSE_TYPE = Object.freeze({
    RAW_MATERIAL: 'raw_material',
    FINISHED_GOOD: 'finished_good',
    PACKAGING: 'packaging',
    GENERAL: 'general'
});

const warehouseTypeLabels = Object.freeze({
    raw_material: '원자재창고',
    finished_good: '완제품창고',
    packaging: '부자재창고',
    general: '일반창고'
});

export const warehouseTypeOptions = Object.freeze(Object.entries(warehouseTypeLabels).map(([value, label]) => Object.freeze({ value, label })));

export function warehouseTypeLabel(code) {
    return warehouseTypeLabels[code] ?? (typeof code === 'string' ? code : '');
}

// Mirrors the database check constraints so users see the problem before a round trip.
export const MASTER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const ITEM_UNIT_PATTERN = /^[A-Z]{1,8}$/;
const BUSINESS_NUMBER_PATTERN = /^\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MASTER_MESSAGES = Object.freeze({
    code: '코드는 영문 대문자, 숫자, 하이픈으로 2자 이상 20자 이하여야 합니다.',
    companyName: '회사명을 입력해 주세요.',
    businessNumber: '사업자등록번호는 숫자 10자리여야 합니다.',
    company: '회사를 선택해 주세요.',
    siteName: '사업장명을 입력해 주세요.',
    siteType: '사업장 유형을 선택해 주세요.',
    itemName: '품목명을 입력해 주세요.',
    itemType: '품목 유형을 선택해 주세요.',
    unit: '단위는 영문 대문자 1자 이상 8자 이하여야 합니다.',
    safetyStock: '안전재고는 0 이상의 숫자여야 합니다.',
    standardPrice: '표준단가는 0 이상의 숫자여야 합니다.',
    site: '사업장을 선택해 주세요.',
    warehouseName: '창고명을 입력해 주세요.',
    warehouseType: '창고 유형을 선택해 주세요.'
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

export function validatePartnerDraft(draft) {
    const hasBusinessNumber = Boolean(normalizeText(draft?.businessNumber));
    const businessNumber = normalizeBusinessNumber(draft?.businessNumber);
    const email = normalizeText(draft?.email);
    const errors = {
        companyId: !normalizeText(draft?.companyId),
        code: !MASTER_CODE_PATTERN.test(normalizeCode(draft?.code)),
        name: !normalizeText(draft?.name),
        roles: draft?.isCustomer !== true && draft?.isVendor !== true,
        businessNumber: hasBusinessNumber && !BUSINESS_NUMBER_PATTERN.test(businessNumber ?? ''),
        email: Boolean(email && !EMAIL_PATTERN.test(email))
    };

    return { errors, isValid: !Object.values(errors).some(Boolean) };
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

const toAmount = (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    const parsed = Number(typeof value === 'string' ? value.replaceAll(',', '').trim() : value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const normalizeUnit = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

export function createItemDraft(item = null, companyId = '') {
    return {
        companyId: item?.companyId ?? companyId ?? '',
        code: item?.code ?? '',
        name: item?.name ?? '',
        itemType: item?.itemType ?? ITEM_TYPE.RAW_MATERIAL,
        unit: item?.unit ?? 'EA',
        safetyStock: item?.safetyStock ?? 0,
        standardPrice: item?.standardPrice ?? 0,
        isActive: item ? item.isActive === true : true
    };
}

export function validateItemDraft(draft) {
    const errors = {};
    if (!normalizeText(draft?.companyId)) errors.companyId = MASTER_MESSAGES.company;
    if (!MASTER_CODE_PATTERN.test(normalizeCode(draft?.code))) errors.code = MASTER_MESSAGES.code;
    if (!normalizeText(draft?.name)) errors.name = MASTER_MESSAGES.itemName;
    if (!Object.hasOwn(itemTypeLabels, draft?.itemType)) errors.itemType = MASTER_MESSAGES.itemType;
    if (!ITEM_UNIT_PATTERN.test(normalizeUnit(draft?.unit))) errors.unit = MASTER_MESSAGES.unit;

    const safetyStock = toAmount(draft?.safetyStock);
    if (!Number.isFinite(safetyStock) || safetyStock < 0) errors.safetyStock = MASTER_MESSAGES.safetyStock;

    const standardPrice = toAmount(draft?.standardPrice);
    if (!Number.isFinite(standardPrice) || standardPrice < 0) errors.standardPrice = MASTER_MESSAGES.standardPrice;

    return errors;
}

export function itemPayload(draft) {
    return {
        companyId: normalizeText(draft.companyId),
        code: normalizeCode(draft.code),
        name: normalizeText(draft.name),
        itemType: draft.itemType,
        unit: normalizeUnit(draft.unit),
        safetyStock: toAmount(draft.safetyStock),
        standardPrice: toAmount(draft.standardPrice),
        isActive: draft.isActive === true
    };
}

export function createWarehouseDraft(warehouse = null, companyId = '', siteId = '') {
    return {
        companyId: warehouse?.companyId ?? companyId ?? '',
        siteId: warehouse?.siteId ?? siteId ?? '',
        code: warehouse?.code ?? '',
        name: warehouse?.name ?? '',
        warehouseType: warehouse?.warehouseType ?? WAREHOUSE_TYPE.GENERAL,
        isActive: warehouse ? warehouse.isActive === true : true
    };
}

export function validateWarehouseDraft(draft) {
    const errors = {};
    if (!normalizeText(draft?.companyId)) errors.companyId = MASTER_MESSAGES.company;
    if (!normalizeText(draft?.siteId)) errors.siteId = MASTER_MESSAGES.site;
    if (!MASTER_CODE_PATTERN.test(normalizeCode(draft?.code))) errors.code = MASTER_MESSAGES.code;
    if (!normalizeText(draft?.name)) errors.name = MASTER_MESSAGES.warehouseName;
    if (!Object.hasOwn(warehouseTypeLabels, draft?.warehouseType)) errors.warehouseType = MASTER_MESSAGES.warehouseType;
    return errors;
}

export function warehousePayload(draft) {
    return {
        companyId: normalizeText(draft.companyId),
        siteId: normalizeText(draft.siteId),
        code: normalizeCode(draft.code),
        name: normalizeText(draft.name),
        warehouseType: draft.warehouseType,
        isActive: draft.isActive === true
    };
}
