/** Pure preview engine. Callers must supply trusted company and target context. */
export const ACTIONS = Object.freeze({ menu: '메뉴', read: '조회', create: '생성', update: '수정', cancel: '취소', submit: '제출', approve: '승인', export: '내보내기', close: '마감', reopen: '마감 취소', manage: '관리' });
export const SCOPES = Object.freeze({ self: '본인', assigned: '배정 업무', organization: '소속 조직', organization_tree: '소속 및 하위 조직', site: '사업장', company: '회사 전체' });
const names = ['일반 직원', '실무 책임자', '부서 관리자', '조직 책임자', '전사 관리자'];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const present = (value) => typeof value === 'string' && value.trim().length > 0;
function dateValue(value) {
    if (!present(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
}
function validAt(row, asOf) {
    const time = dateValue(asOf);
    return Number.isFinite(time) && (!row.from || dateValue(row.from) <= time) && (!row.to || time < dateValue(row.to));
}
export function createDefaultPolicy(resources) {
    return {
        levels: names.map((name, index) => ({
            id: index + 1,
            name,
            permissions: resources.filter((r) => index === 4 || (index === 0 && r.key === 'dashboard')).flatMap((r) => ['menu', 'read'].map((action) => ({ resource: r.key, action, scope: index === 4 ? 'company' : 'self' })))
        })),
        mappings: [],
        members: [],
        roles: [],
        overrides: []
    };
}
export function resolveLevel(policy, member, asOf) {
    if (!member || member.active !== true || !validAt(member, asOf)) return { level: null, source: 'inactive' };
    if (Number.isInteger(member.level) && policy.levels.some((l) => l.id === member.level)) return { level: member.level, source: 'explicit' };
    for (const kind of ['position', 'grade']) {
        const matches = policy.mappings.filter((m) => m.kind === kind && present(member[kind]) && m.code === member[kind] && validAt(m, asOf));
        if (matches.length > 1) return { level: null, source: 'ambiguous' };
        if (matches.length === 1 && policy.levels.some((l) => l.id === matches[0].level)) return { level: matches[0].level, source: kind };
    }
    return { level: null, source: 'unassigned' };
}
function matchesScope(scope, member, request) {
    const same = (a, b) => present(a) && present(b) && a === b;
    switch (scope) {
        case 'company':
            return true;
        case 'self':
            return same(request.subjectId, member.id);
        case 'assigned':
            return same(request.assigneeId, member.id);
        case 'organization':
            return same(request.organizationId, member.organizationId);
        case 'organization_tree':
            return (
                same(request.organizationId, member.organizationId) ||
                (present(request.organizationId) && present(member.organizationId) && Array.isArray(request.ancestorOrganizationIds) && request.ancestorOrganizationIds.includes(member.organizationId))
            );
        case 'site':
            return same(request.siteId, member.siteId);
        default:
            return false;
    }
}
export function explainAccess(policy, request) {
    const deny = (reason, level = null, sources = []) => ({ allowed: false, level, reason, sources });
    if (!present(request.companyId) || request.companyId !== request.policyCompanyId) return deny('회사 경계 불일치');
    if (request.active !== true || request.aal !== 2) return deny('활성 사용자 및 AAL2 인증 필요');
    if (request.moduleState !== 'enabled') return deny('비활성 모듈');
    if (!Number.isFinite(dateValue(request.asOf))) return deny('유효한 기준시각 필요');
    const members = policy.members.filter((m) => m.id === request.actorId);
    const member = members.length === 1 ? members[0] : null;
    if (!member || member.active !== true || !validAt(member, request.asOf)) return deny('유효한 회사 멤버십 없음');
    const { level, source } = resolveLevel(policy, member, request.asOf);
    const matching = (p) => p.resource === request.resource && p.action === request.action && has(ACTIONS, p.action) && matchesScope(p.scope, member, request);
    const overrides = policy.overrides.filter((o) => o.actorId === member.id && validAt(o, request.asOf) && matching(o));
    if (overrides.some((o) => o.effect === 'deny')) return deny('개별 제한 우선', level, ['override:deny']);
    const sources = [];
    if (policy.levels.find((l) => l.id === level)?.permissions.some(matching)) sources.push(`level:${level}:${source}`);
    for (const role of policy.roles) if (role.members.includes(member.id) && role.permissions.some(matching)) sources.push(`role:${role.id}`);
    if (overrides.some((o) => o.effect === 'allow')) sources.push('override:allow');
    return sources.length ? { allowed: true, level, reason: '일치하는 권한 허용', sources } : deny('일치하는 권한 없음', level);
}
export function validatePolicy(policy, resources) {
    const fail = (message) => {
        throw new Error(message);
    };
    const unique = (items, key, label) => {
        const keys = items.map(key);
        if (new Set(keys).size !== keys.length) fail(`${label} 중복`);
    };
    if (!policy || ['levels', 'mappings', 'members', 'roles', 'overrides'].some((k) => !Array.isArray(policy[k]))) fail('정책 목록 형식 오류');
    if (!Array.isArray(resources)) fail('리소스 목록 형식 오류');
    unique(resources, (r) => r.key, '리소스');
    const validLevel = (id) => Number.isInteger(id) && id >= 1 && id <= 5 && policy.levels.some((l) => l.id === id);
    const range = (row) => {
        if ((row.from != null && row.from !== '' && !Number.isFinite(dateValue(row.from))) || (row.to != null && row.to !== '' && !Number.isFinite(dateValue(row.to)))) fail('유효기간 날짜 형식 오류');
        if (row.from && row.to && dateValue(row.from) >= dateValue(row.to)) fail('유효기간 종료는 시작 이후여야 합니다');
    };
    const permission = (p) => {
        if (!p || !resources.some((r) => r.key === p.resource)) fail('등록되지 않은 리소스');
        if (!has(ACTIONS, p.action)) fail('등록되지 않은 행동');
        if (!has(SCOPES, p.scope)) fail('등록되지 않은 범위');
    };
    const permissions = (list) => {
        if (!Array.isArray(list)) fail('권한 목록 형식 오류');
        list.forEach(permission);
        unique(list, (p) => JSON.stringify([p.resource, p.action, p.scope]), '권한');
    };
    unique(policy.levels, (l) => l.id, '등급');
    if (policy.levels.length !== 5) fail('등급 1~5가 필요합니다');
    policy.levels.forEach((l) => {
        if (!validLevel(l.id) || !present(l.name)) fail('등급 번호 또는 이름 오류');
        permissions(l.permissions);
    });
    unique(policy.members, (m) => m.id, '멤버십');
    policy.members.forEach((m) => {
        if (!present(m.id) || !present(m.name) || typeof m.active !== 'boolean' || (m.level != null && !validLevel(m.level))) fail('멤버십 또는 등급 오류');
        range(m);
    });
    policy.mappings.forEach((m, index) => {
        if (!['grade', 'position'].includes(m.kind) || !present(m.code) || !validLevel(m.level)) fail('직급·직책 매핑 오류');
        range(m);
        if (
            policy.mappings
                .slice(0, index)
                .some(
                    (other) =>
                        other.kind === m.kind && other.code === m.code && (m.from ? dateValue(m.from) : -Infinity) < (other.to ? dateValue(other.to) : Infinity) && (other.from ? dateValue(other.from) : -Infinity) < (m.to ? dateValue(m.to) : Infinity)
                )
        )
            fail('동일 직급·직책 유효기간 중복');
    });
    unique(policy.roles, (r) => r.id, '업무 역할');
    policy.roles.forEach((r) => {
        if (!present(r.id) || !present(r.name) || !Array.isArray(r.members) || r.members.some((id) => !policy.members.some((m) => m.id === id))) fail('업무 역할 멤버 오류');
        unique(r.members, (id) => id, '업무 역할 멤버');
        permissions(r.permissions);
    });
    policy.overrides.forEach((o) => {
        permission(o);
        range(o);
        if (!['allow', 'deny'].includes(o.effect) || !policy.members.some((m) => m.id === o.actorId)) fail('사용자 예외 오류');
    });
    return true;
}
