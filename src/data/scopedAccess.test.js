import { describe, expect, it } from 'vitest';
import { scopedAccessLabel, secondaryScopeMatches } from './scopedAccess';

describe('secondaryScopeMatches', () => {
    const base = { assignmentDepartment: 'DEV', descendants: ['DEV1'], targetDepartment: 'DEV', assignmentSiteId: 'site-1', targetSiteId: 'site-1' };
    it('caps organization and tree scopes', () => {
        expect(secondaryScopeMatches({ ...base, policyScope: 'organization' })).toBe(true);
        expect(secondaryScopeMatches({ ...base, policyScope: 'organization', targetDepartment: 'DEV1' })).toBe(false);
        expect(secondaryScopeMatches({ ...base, policyScope: 'organization_tree', targetDepartment: 'DEV1' })).toBe(true);
        expect(secondaryScopeMatches({ ...base, policyScope: 'company', targetDepartment: 'DEV1' })).toBe(true);
    });
    it('requires the assignment site for site scope and rejects personal scopes', () => {
        expect(secondaryScopeMatches({ ...base, policyScope: 'site', targetDepartment: 'DEV1', targetSiteId: 'site-2' })).toBe(false);
        expect(secondaryScopeMatches({ ...base, policyScope: 'self' })).toBe(false);
        expect(secondaryScopeMatches({ ...base, policyScope: 'assigned' })).toBe(false);
        expect(secondaryScopeMatches({ ...base, policyScope: 'organization_tree', targetDepartment: '' })).toBe(false);
    });
});

it('describes the unchanged grade and capped scope', () => {
    expect(scopedAccessLabel({ gradeName: '대리', positionLevel: 4, departmentName: '개발팀', policyScope: 'organization_tree' })).toBe('개인 직급 대리 유지 · 겸직 직책 레벨 4 · 개발팀 및 하위 조직');
});
