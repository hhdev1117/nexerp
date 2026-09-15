import { describe, expect, it } from 'vitest';
import {
    MASTER_MESSAGES,
    ITEM_TYPE,
    SITE_TYPE,
    WAREHOUSE_TYPE,
    companyPayload,
    createCompanyDraft,
    createItemDraft,
    createSiteDraft,
    createWarehouseDraft,
    formatBusinessNumber,
    itemPayload,
    itemTypeLabel,
    itemTypeOptions,
    normalizeBusinessNumber,
    normalizeCode,
    sitePayload,
    siteTypeLabel,
    siteTypeOptions,
    validateCompanyDraft,
    validateItemDraft,
    validatePartnerDraft,
    validateSiteDraft,
    validateWarehouseDraft,
    warehousePayload,
    warehouseTypeLabel,
    warehouseTypeOptions
} from './master';

describe('company master rules', () => {
    it('normalizes codes and business registration numbers', () => {
        expect(normalizeCode(' nxm ')).toBe('NXM');
        expect(normalizeCode(undefined)).toBe('');
        expect(normalizeBusinessNumber('120-88-12345')).toBe('1208812345');
        expect(normalizeBusinessNumber('')).toBeNull();
        expect(normalizeBusinessNumber(null)).toBeNull();
        expect(formatBusinessNumber('1208812345')).toBe('120-88-12345');
        expect(formatBusinessNumber(null)).toBe('');
        expect(formatBusinessNumber('1234')).toBe('1234');
    });

    it('validates a company draft against the database constraints', () => {
        expect(validateCompanyDraft(createCompanyDraft())).toEqual({ code: MASTER_MESSAGES.code, name: MASTER_MESSAGES.companyName });
        expect(validateCompanyDraft({ code: 'a', name: '단일 문자' })).toEqual({ code: MASTER_MESSAGES.code });
        expect(validateCompanyDraft({ code: 'NX_M', name: '밑줄' })).toEqual({ code: MASTER_MESSAGES.code });
        expect(validateCompanyDraft({ code: 'A'.repeat(21), name: '너무 긺' })).toEqual({ code: MASTER_MESSAGES.code });
        expect(validateCompanyDraft({ code: 'nxm', name: ' 넥서스 ', businessNumber: '120-88-1234' })).toEqual({ businessNumber: MASTER_MESSAGES.businessNumber });
        expect(validateCompanyDraft({ code: 'nxm', name: '넥서스', businessNumber: '120-88-12345' })).toEqual({});
        expect(validateCompanyDraft({ code: 'NXM-2026', name: '넥서스', businessNumber: '' })).toEqual({});
    });

    it('builds a normalized company payload and a matching edit draft', () => {
        expect(companyPayload({ code: ' nxm ', name: ' 넥서스 제조 ', businessNumber: '120-88-12345', representative: ' 김정호 ', address: ' 인천 ', isActive: true, submitted: true })).toEqual({
            code: 'NXM',
            name: '넥서스 제조',
            businessNumber: '1208812345',
            representative: '김정호',
            address: '인천',
            isActive: true
        });
        expect(companyPayload({ code: 'NXM', name: '넥서스', businessNumber: '' })).toMatchObject({ businessNumber: null, representative: '', address: '', isActive: false });
        expect(createCompanyDraft({ code: 'NXM', name: '넥서스 제조', businessNumber: '1208812345', representative: '김정호', address: '인천', isActive: false })).toEqual({
            code: 'NXM',
            name: '넥서스 제조',
            businessNumber: '120-88-12345',
            representative: '김정호',
            address: '인천',
            isActive: false
        });
        expect(createCompanyDraft()).toEqual({ code: '', name: '', businessNumber: '', representative: '', address: '', isActive: true });
    });
});

describe('partner master rules', () => {
    it('flags every invalid required field and malformed optional field', () => {
        expect(
            validatePartnerDraft({
                companyId: ' ',
                code: 'partner_1',
                name: ' ',
                isCustomer: false,
                isVendor: false,
                businessNumber: '120-88-1234',
                email: 'billing @example.com'
            })
        ).toEqual({
            errors: {
                companyId: true,
                code: true,
                name: true,
                roles: true,
                businessNumber: true,
                email: true
            },
            isValid: false
        });
    });

    it.each([
        ['customer-only', true, false],
        ['vendor-only', false, true],
        ['dual-role', true, true]
    ])('accepts a normalized code for a %s partner and empty optional fields', (_label, isCustomer, isVendor) => {
        expect(validatePartnerDraft({ companyId: 'company-1', code: ' partner-1 ', name: ' 넥서스 ', isCustomer, isVendor, businessNumber: '', email: '' })).toEqual({
            errors: { companyId: false, code: false, name: false, roles: false, businessNumber: false, email: false },
            isValid: true
        });
    });

    it('rejects a supplied business number that normalizes to no digits', () => {
        const result = validatePartnerDraft({ companyId: 'company-1', code: 'PARTNER-1', name: '넥서스', isCustomer: true, isVendor: false, businessNumber: 'abc', email: '' });

        expect(result.errors.businessNumber).toBe(true);
        expect(result.isValid).toBe(false);
    });
});

describe('site master rules', () => {
    it('labels every site type in Korean and falls back safely', () => {
        expect(siteTypeOptions.map((option) => option.value)).toEqual(Object.values(SITE_TYPE));
        expect(siteTypeOptions.map((option) => option.label)).toEqual(['본사', '공장', '물류센터', '지점', '기타']);
        expect(siteTypeLabel(SITE_TYPE.HEAD_OFFICE)).toBe('본사');
        expect(siteTypeLabel('warehouse')).toBe('물류센터');
        expect(siteTypeLabel('unknown')).toBe('unknown');
        expect(siteTypeLabel(undefined)).toBe('');
    });

    it('validates a site draft', () => {
        expect(validateSiteDraft(createSiteDraft())).toEqual({ companyId: MASTER_MESSAGES.company, code: MASTER_MESSAGES.code, name: MASTER_MESSAGES.siteName });
        expect(validateSiteDraft({ companyId: 'c1', code: 'icn', name: '인천 공장', siteType: 'plant' })).toEqual({ siteType: MASTER_MESSAGES.siteType });
        expect(validateSiteDraft({ companyId: 'c1', code: 'icn', name: '인천 공장', siteType: SITE_TYPE.FACTORY })).toEqual({});
    });

    it('builds site drafts and normalized payloads', () => {
        expect(createSiteDraft(null, 'company-nxm')).toEqual({ companyId: 'company-nxm', code: '', name: '', siteType: SITE_TYPE.OTHER, address: '', isActive: true });
        expect(createSiteDraft({ companyId: 'c1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: false })).toEqual({
            companyId: 'c1',
            code: 'ICN',
            name: '인천 공장',
            siteType: 'factory',
            address: '인천',
            isActive: false
        });
        expect(sitePayload({ companyId: ' c1 ', code: ' icn ', name: ' 인천 공장 ', siteType: 'factory', address: ' 인천 ', isActive: true })).toEqual({
            companyId: 'c1',
            code: 'ICN',
            name: '인천 공장',
            siteType: 'factory',
            address: '인천',
            isActive: true
        });
    });
});

describe('item master rules', () => {
    it('labels item types in Korean and falls back to the raw code', () => {
        expect(itemTypeLabel(ITEM_TYPE.RAW_MATERIAL)).toBe('원자재');
        expect(itemTypeLabel(ITEM_TYPE.FINISHED_GOOD)).toBe('완제품');
        expect(itemTypeLabel('unmapped')).toBe('unmapped');
        expect(itemTypeOptions.map((option) => option.value)).toEqual(['raw_material', 'semi_finished', 'finished_good', 'consumable', 'service']);
    });

    it('drafts a new item with safe defaults and reuses an existing one', () => {
        expect(createItemDraft(null, 'company-1')).toEqual({ companyId: 'company-1', code: '', name: '', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 0, standardPrice: 0, isActive: true });
        expect(createItemDraft({ companyId: 'c1', code: 'FG-001', name: '완제품', itemType: ITEM_TYPE.FINISHED_GOOD, unit: 'BOX', safetyStock: 12, standardPrice: 5000, isActive: false })).toEqual({
            companyId: 'c1',
            code: 'FG-001',
            name: '완제품',
            itemType: ITEM_TYPE.FINISHED_GOOD,
            unit: 'BOX',
            safetyStock: 12,
            standardPrice: 5000,
            isActive: false
        });
    });

    it('mirrors the database constraints when validating a draft', () => {
        expect(validateItemDraft({ companyId: 'c1', code: 'RM-001', name: '원자재', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: 10, standardPrice: 100 })).toEqual({});

        // Lower case is normalized rather than rejected, so invalid shapes must be genuinely invalid.
        expect(validateItemDraft({ companyId: 'c1', code: 'rm-001', name: '원자재', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'ea', safetyStock: 0, standardPrice: 0 })).toEqual({});

        const errors = validateItemDraft({ companyId: '', code: 'R', name: '  ', itemType: 'unknown', unit: 'EA-1', safetyStock: -1, standardPrice: 'abc' });
        expect(Object.keys(errors).sort()).toEqual(['code', 'companyId', 'itemType', 'name', 'safetyStock', 'standardPrice', 'unit']);
    });

    it('accepts formatted numbers and treats a blank amount as zero', () => {
        expect(validateItemDraft({ companyId: 'c1', code: 'RM-001', name: '원자재', itemType: ITEM_TYPE.RAW_MATERIAL, unit: 'EA', safetyStock: '1,200', standardPrice: '' })).toEqual({});
        expect(itemPayload({ companyId: ' c1 ', code: ' rm-001 ', name: ' 원자재 ', itemType: ITEM_TYPE.RAW_MATERIAL, unit: ' ea ', safetyStock: '1,200', standardPrice: '', isActive: true })).toEqual({
            companyId: 'c1',
            code: 'RM-001',
            name: '원자재',
            itemType: ITEM_TYPE.RAW_MATERIAL,
            unit: 'EA',
            safetyStock: 1200,
            standardPrice: 0,
            isActive: true
        });
    });
});

describe('warehouse master rules', () => {
    it('labels warehouse types in Korean and falls back to the raw code', () => {
        expect(warehouseTypeLabel(WAREHOUSE_TYPE.RAW_MATERIAL)).toBe('원자재창고');
        expect(warehouseTypeLabel(WAREHOUSE_TYPE.PACKAGING)).toBe('부자재창고');
        expect(warehouseTypeLabel('unmapped')).toBe('unmapped');
        expect(warehouseTypeOptions.map((option) => option.value)).toEqual(['raw_material', 'finished_good', 'packaging', 'general']);
    });

    it('drafts with the general type and carries the company and site through', () => {
        expect(createWarehouseDraft(null, 'company-1', 'site-1')).toEqual({ companyId: 'company-1', siteId: 'site-1', code: '', name: '', warehouseType: WAREHOUSE_TYPE.GENERAL, isActive: true });
        expect(createWarehouseDraft({ companyId: 'c1', siteId: 's1', code: 'WH-1', name: '창고', warehouseType: WAREHOUSE_TYPE.PACKAGING, isActive: false })).toEqual({
            companyId: 'c1',
            siteId: 's1',
            code: 'WH-1',
            name: '창고',
            warehouseType: WAREHOUSE_TYPE.PACKAGING,
            isActive: false
        });
    });

    it('requires a company, a site, a valid code, a name and a known type', () => {
        expect(validateWarehouseDraft({ companyId: 'c1', siteId: 's1', code: 'WH-ICN-RM', name: '인천 원자재창고', warehouseType: WAREHOUSE_TYPE.RAW_MATERIAL })).toEqual({});

        const errors = validateWarehouseDraft({ companyId: '', siteId: '', code: 'W', name: '  ', warehouseType: 'unknown' });
        expect(Object.keys(errors).sort()).toEqual(['code', 'companyId', 'name', 'siteId', 'warehouseType']);
    });

    it('normalizes the code and trims identifiers on the payload', () => {
        expect(warehousePayload({ companyId: ' c1 ', siteId: ' s1 ', code: ' wh-icn-rm ', name: ' 인천 원자재창고 ', warehouseType: WAREHOUSE_TYPE.RAW_MATERIAL, isActive: true })).toEqual({
            companyId: 'c1',
            siteId: 's1',
            code: 'WH-ICN-RM',
            name: '인천 원자재창고',
            warehouseType: WAREHOUSE_TYPE.RAW_MATERIAL,
            isActive: true
        });
    });
});
