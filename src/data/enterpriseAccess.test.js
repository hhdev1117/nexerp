import { describe, expect, it } from 'vitest';
import { createDefaultPolicy, resolveLevel, explainAccess, validatePolicy } from './enterpriseAccess';

const resources = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'payroll', label: '급여' }
];
function fixture() {
    const policy = createDefaultPolicy(resources);
    policy.members = [{ id: 'alice', name: '직원', grade: 'staff', position: 'lead', level: null, organizationId: 'team', siteId: 'hq', active: true }];
    policy.mappings = [
        { kind: 'grade', code: 'staff', level: 1 },
        { kind: 'position', code: 'lead', level: 4, from: '2026-01-01', to: '2027-01-01' }
    ];
    return policy;
}
const request = { actorId: 'alice', companyId: 'a', policyCompanyId: 'a', resource: 'payroll', action: 'read', subjectId: 'bob', asOf: '2026-09-14', moduleState: 'enabled', active: true, aal: 2 };
describe('enterprise access policy', () => {
    it.each(['2026-09-14T00:00:00Z', 'now', 'infinity', '2026-02-30'])('rejects non-calendar date %s in policy and preview', (date) => {
        const p = fixture();
        p.members[0].level = 5;
        expect(explainAccess(p, { ...request, asOf: date }).allowed).toBe(false);
        p.mappings[0].from = date;
        expect(() => validatePolicy(p, resources)).toThrow(/날짜/);
    });
    it('seeds explicit read/menu only and never invents memberships', () => {
        const p = createDefaultPolicy(resources);
        expect(p.levels.map((l) => l.id)).toEqual([1, 2, 3, 4, 5]);
        expect(p.levels[4].permissions).toHaveLength(4);
        expect(p.levels[4].permissions.every((x) => ['menu', 'read'].includes(x.action) && x.scope === 'company')).toBe(true);
        expect(explainAccess(p, request).allowed).toBe(false);
    });
    it('uses explicit then position then grade with half-open expiry', () => {
        const p = fixture(),
            m = p.members[0];
        expect(resolveLevel(p, m, request.asOf)).toMatchObject({ level: 4, source: 'position' });
        expect(resolveLevel(p, m, '2027-01-01')).toMatchObject({ level: 1, source: 'grade' });
        m.level = 3;
        expect(resolveLevel(p, m, request.asOf)).toMatchObject({ level: 3, source: 'explicit' });
        m.level = null;
        m.grade = 'unknown';
        m.position = null;
        expect(resolveLevel(p, m, request.asOf).level).toBe(null);
    });
    it('preserves action and scope pairing across roles', () => {
        const p = fixture();
        p.roles = [
            {
                id: 'pay',
                name: '급여',
                members: ['alice'],
                permissions: [
                    { resource: 'payroll', action: 'read', scope: 'company' },
                    { resource: 'payroll', action: 'update', scope: 'self' }
                ]
            }
        ];
        expect(explainAccess(p, request).allowed).toBe(true);
        expect(explainAccess(p, { ...request, action: 'update' }).allowed).toBe(false);
        expect(explainAccess(p, { ...request, action: 'update', subjectId: 'alice' }).allowed).toBe(true);
    });
    it('applies deny only to its matching scope and valid period', () => {
        const p = fixture();
        p.members[0].level = 5;
        p.overrides = [{ actorId: 'alice', resource: 'payroll', action: 'read', scope: 'self', effect: 'deny', to: '2027-01-01' }];
        expect(explainAccess(p, request).allowed).toBe(true);
        expect(explainAccess(p, { ...request, subjectId: 'alice' }).allowed).toBe(false);
        expect(explainAccess(p, { ...request, subjectId: 'alice', asOf: '2027-01-01' }).allowed).toBe(true);
    });
    it.each([{ companyId: 'b' }, { moduleState: 'disabled' }, { active: false }, { aal: 1 }, { actorId: 'missing' }, { asOf: 'bad' }])('fails closed for mandatory boundary %j', (patch) => {
        const p = fixture();
        p.members[0].level = 5;
        expect(explainAccess(p, { ...request, ...patch }).allowed).toBe(false);
    });
    it('expires membership and requires active membership even with direct allows', () => {
        const p = fixture();
        p.members[0].to = request.asOf;
        p.overrides = [{ actorId: 'alice', resource: 'payroll', action: 'read', scope: 'company', effect: 'allow' }];
        expect(explainAccess(p, request).allowed).toBe(false);
    });
    it('denies inactive and future memberships even at level five', () => {
        const p = fixture();
        p.members[0].level = 5;
        p.members[0].active = false;
        expect(explainAccess(p, request).allowed).toBe(false);
        p.members[0].active = true;
        p.members[0].from = '2026-09-15';
        expect(explainAccess(p, request).allowed).toBe(false);
    });
    it('never grants a permission with missing scope or a newly added resource', () => {
        const p = fixture();
        p.members[0].level = 5;
        p.overrides = [{ actorId: 'alice', resource: 'new', action: 'read', effect: 'allow' }];
        expect(explainAccess(p, { ...request, resource: 'new' }).allowed).toBe(false);
        expect(() => validatePolicy(p, [...resources, { key: 'new', label: '신규' }])).toThrow(/범위/);
    });
    it.each([
        ['organization', { organizationId: 'team' }, { organizationId: 'other' }],
        ['organization_tree', { organizationId: 'child', ancestorOrganizationIds: ['team'] }, { organizationId: 'other' }],
        ['site', { siteId: 'hq' }, { siteId: 'branch' }],
        ['assigned', { assigneeId: 'alice' }, { assigneeId: 'bob' }]
    ])('checks %s scope without accepting missing targets', (scope, yes, no) => {
        const p = fixture();
        p.levels[3].permissions = [{ resource: 'payroll', action: 'read', scope }];
        expect(explainAccess(p, { ...request, ...yes }).allowed).toBe(true);
        expect(explainAccess(p, { ...request, ...no }).allowed).toBe(false);
        expect(explainAccess(p, request).allowed).toBe(false);
    });
    it('validates defaults and rejects overlapping mapping dates but permits adjacent periods', () => {
        const p = fixture();
        expect(() => validatePolicy(p, resources)).not.toThrow();
        p.mappings.push({ kind: 'position', code: 'lead', level: 3, from: '2027-01-01' });
        expect(() => validatePolicy(p, resources)).not.toThrow();
        p.mappings[2].from = '2026-12-31';
        expect(() => validatePolicy(p, resources)).toThrow(/중복/);
    });
    it.each([
        (p) => {
            p.members.push({ ...p.members[0] });
        },
        (p) => {
            p.mappings[0].level = 6;
        },
        (p) => {
            p.mappings[0].from = '2026-02-30';
        },
        (p) => {
            p.mappings[0].from = '2027-01-01';
            p.mappings[0].to = '2026-01-01';
        },
        (p) => {
            p.levels[0].permissions.push({ resource: 'payroll', action: 'hack', scope: 'company' });
        },
        (p) => {
            p.levels[0].permissions.push({ resource: 'payroll', action: 'read', scope: 'world' });
        },
        (p) => {
            p.levels[0].permissions.push({ resource: 'unknown', action: 'read', scope: 'self' });
        }
    ])('rejects malformed policies', (mutate) => {
        const p = fixture();
        mutate(p);
        expect(() => validatePolicy(p, resources)).toThrow();
    });
});
