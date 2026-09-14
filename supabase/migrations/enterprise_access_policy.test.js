import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('./20260914000200_enterprise_access_policy.sql', import.meta.url), 'utf8');
describe('staged enterprise policy migration', () => {
    it('keeps writes atomic, serialized and audited', () => {
        expect(sql).toMatch(/for update/i);
        expect(sql).toMatch(/revision_conflict/);
        expect(sql).toMatch(/insert into public.enterprise_access_policy_audit/i);
        expect(sql).toMatch(/revoke all on public.enterprise_access_policies/);
        expect(sql).not.toMatch(/grant (insert|update|delete)/i);
    });
    it('requires MFA admin and validates the full document on server', () => {
        expect(sql).toMatch(/private.is_admin\(\)/);
        for (const field of ['levels', 'mappings', 'members', 'roles', 'overrides']) expect(sql).toContain(field);
        expect(sql).toMatch(/public.profiles/);
        expect(sql).toMatch(/site.company_id = target_company/);
        expect(sql).toMatch(/expected_revision/);
        expect(sql).toMatch(/invalid_policy/);
    });
});

it('registers every ERP menu resource and restricts permission resources', () => {
    const menu = readFileSync(new URL('../../src/data/erp.js', import.meta.url), 'utf8');
    const keys = [...menu.matchAll(/makeItem\('([^']+)'/g)].map((match) => match[1]);
    const registry = readFileSync(new URL('./20260914000400_hr_employee_ledger.sql', import.meta.url), 'utf8');
    for (const key of keys) expect(registry).toContain("'" + key + "'");
    expect(sql).toContain("value->>'resource' = any(private.enterprise_resources())");
    expect(sql).toContain('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    expect(sql).toContain('daterange(');
});
