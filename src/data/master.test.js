import { describe, expect, it } from 'vitest';
import { MASTER_MESSAGES, SITE_TYPE, companyPayload, createCompanyDraft, createSiteDraft, formatBusinessNumber, normalizeBusinessNumber, normalizeCode, sitePayload, siteTypeLabel, siteTypeOptions, validateCompanyDraft, validateSiteDraft } from './master';

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
        expect(createSiteDraft({ companyId: 'c1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: false })).toEqual({ companyId: 'c1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: false });
        expect(sitePayload({ companyId: ' c1 ', code: ' icn ', name: ' 인천 공장 ', siteType: 'factory', address: ' 인천 ', isActive: true })).toEqual({ companyId: 'c1', code: 'ICN', name: '인천 공장', siteType: 'factory', address: '인천', isActive: true });
    });
});
