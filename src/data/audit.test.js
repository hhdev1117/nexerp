import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION, auditActionLabel, auditActionSeverity, auditChanges, auditFieldLabel, auditQuery, auditSubject, auditedTableLabel, createAuditFilter, formatAuditTimestamp, formatAuditValue } from './audit';

const entry = (overrides) => ({ id: 1, tableName: 'companies', recordId: 'company-id', action: AUDIT_ACTION.UPDATE, actorId: 'actor', changedAt: '2026-09-15T01:00:00.000Z', oldData: null, newData: null, ...overrides });

describe('audit ledger rules', () => {
    it('labels actions, tables and fields with Korean names and falls back to the raw code', () => {
        expect(auditActionLabel(AUDIT_ACTION.INSERT)).toBe('등록');
        expect(auditActionSeverity(AUDIT_ACTION.DELETE)).toBe('danger');
        expect(auditActionSeverity('unknown')).toBe('secondary');
        expect(auditedTableLabel('partners')).toBe('거래처');
        expect(auditedTableLabel('sales_orders')).toBe('sales_orders');
        expect(auditFieldLabel('business_number')).toBe('사업자등록번호');
        expect(auditFieldLabel('unmapped_column')).toBe('unmapped_column');
    });

    it('lists only the fields an update actually changed', () => {
        const changes = auditChanges(
            entry({
                oldData: { id: 'company-id', code: 'NXM', name: '넥서스 제조', is_active: true, updated_at: '2026-09-14T00:00:00.000Z' },
                newData: { id: 'company-id', code: 'NXM', name: '넥서스 제조 주식회사', is_active: false, updated_at: '2026-09-15T00:00:00.000Z' }
            })
        );

        expect(changes).toEqual([
            { field: 'name', label: '명칭', before: '넥서스 제조', after: '넥서스 제조 주식회사' },
            { field: 'is_active', label: '사용 여부', before: true, after: false }
        ]);
    });

    it('lists every meaningful field for inserts and deletes', () => {
        const created = auditChanges(entry({ action: AUDIT_ACTION.INSERT, newData: { id: 'x', code: 'NXM', name: '넥서스', created_by: 'actor' } }));
        expect(created).toEqual([
            { field: 'code', label: '코드', before: null, after: 'NXM' },
            { field: 'name', label: '명칭', before: null, after: '넥서스' }
        ]);

        const removed = auditChanges(entry({ action: AUDIT_ACTION.DELETE, oldData: { id: 'x', code: 'NXM', name: '넥서스' } }));
        expect(removed).toEqual([
            { field: 'code', label: '코드', before: 'NXM', after: null },
            { field: 'name', label: '명칭', before: '넥서스', after: null }
        ]);
    });

    it('formats values for reading without leaking raw nulls', () => {
        expect(formatAuditValue(null)).toBe('—');
        expect(formatAuditValue('')).toBe('—');
        expect(formatAuditValue(true)).toBe('예');
        expect(formatAuditValue(false)).toBe('아니오');
        expect(formatAuditValue(30)).toBe('30');
        expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    });

    it('names the affected record from whichever snapshot exists', () => {
        expect(auditSubject(entry({ newData: { code: 'NXM', name: '넥서스 제조' } }))).toBe('NXM · 넥서스 제조');
        expect(auditSubject(entry({ oldData: { name: '이름만' } }))).toBe('이름만');
        expect(auditSubject(entry({}))).toBe('company-id');
    });

    it('formats timestamps in local time and ignores unusable input', () => {
        expect(formatAuditTimestamp('not a date')).toBe('');
        expect(formatAuditTimestamp(null)).toBe('');
        expect(formatAuditTimestamp('2026-09-15T01:02:03.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('turns screen filters into repository parameters and rejects unknown values', () => {
        expect(auditQuery(createAuditFilter())).toEqual({ tableName: null, actorId: null, action: null, from: null, to: null, page: 1 });
        expect(auditQuery({ tableName: 'not_audited', actorId: '', action: 'archive', page: 0 })).toEqual({ tableName: null, actorId: null, action: null, from: null, to: null, page: 1 });

        const query = auditQuery({ tableName: 'sites', actorId: 'actor', action: AUDIT_ACTION.UPDATE, from: new Date(2026, 8, 1), to: new Date(2026, 8, 15), page: 3 });
        expect(query.tableName).toBe('sites');
        expect(query.actorId).toBe('actor');
        expect(query.action).toBe(AUDIT_ACTION.UPDATE);
        expect(query.page).toBe(3);
        expect(new Date(query.from).getTime()).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
        expect(new Date(query.to).getTime()).toBe(new Date(2026, 8, 15, 23, 59, 59, 999).getTime());
    });
});
