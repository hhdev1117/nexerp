const DERIVED_SCOPES = new Set(['organization', 'organization_tree', 'site']);

export function secondaryScopeMatches(input) {
    const scope = input?.policyScope === 'company' ? 'organization_tree' : input?.policyScope;
    if (!DERIVED_SCOPES.has(scope) || !input?.targetDepartment) return false;
    const descendants = Array.isArray(input.descendants) ? input.descendants : [];
    const inTree = input.targetDepartment === input.assignmentDepartment || descendants.includes(input.targetDepartment);
    if (scope === 'organization') return input.targetDepartment === input.assignmentDepartment;
    if (scope === 'site') return inTree && input.targetSiteId === input.assignmentSiteId;
    return inTree;
}

export function scopedAccessLabel({ gradeName, positionLevel, departmentName, policyScope }) {
    const suffix = policyScope === 'organization' ? '' : ' 및 하위 조직';
    return `개인 직급 ${gradeName} 유지 · 겸직 직책 레벨 ${positionLevel} · ${departmentName}${suffix}`;
}
