import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('./20260914000300_enterprise_access_activation.sql', import.meta.url), 'utf8');
describe('enterprise activation SQL contract', () => {
    it('exposes own JSON context and administrator publication RPCs only', () => {
        for (const name of ['enterprise_access_context', 'enterprise_access_publication', 'enterprise_publish_access_policy', 'enterprise_revert_access_policy', 'enterprise_access_companies', 'enterprise_access_sites'])
            expect(sql).toContain('function public.' + name);
        for (const key of ['mode', 'companyId', 'companies', 'menuKeys', 'revision', 'companyActions', 'siteActions']) expect(sql).toContain("'" + key + "'");
        expect(sql).toContain('auth.uid()');
        expect(sql).toContain("'Asia/Seoul'");
        expect(sql).toContain('revoke all on public.enterprise_access_publications');
    });
    it('replaces every permissive legacy policy except administrator company creation', () => {
        for (const name of ['Active users read companies', 'Active admins update companies', 'Active users read sites', 'Active admins insert sites', 'Active admins update sites']) expect(sql).toContain('drop policy "' + name + '"');
        expect(sql).not.toContain('drop policy "Active admins insert companies"');
        expect(sql).toContain("private.enterprise_master_access(company_id,'update',id)");
    });
    it('publishes locked saved revisions and only restores an existing snapshot', () => {
        expect(sql).toContain('for update');
        expect(sql).toContain('draft_revision_conflict');
        expect(sql).toContain('no_previous_publication');
        expect(sql).toContain('no_active_membership');
        expect(sql).not.toMatch(/delete from public.enterprise_access_publications/i);
        expect(sql).not.toMatch(/update public.enterprise_access_publications/i);
    });
    it('closes unactivated-company fallback after activation and checks separate navigation actions', () => {
        expect(sql).toContain("private.enterprise_allowed(selected,resource,'menu',s)");
        expect(sql).toContain("private.enterprise_allowed(selected,resource,'read',s)");
        expect(sql).toContain('not global_active');
        expect(sql).toContain("p->>'effect'='deny'");
    });
});

it('preserves explicit inactive-company recovery and scope/override semantics', () => {
    expect(sql).toContain("resource_key='settings.company' and action_key in ('menu','read','update')");
    expect(sql).toContain("scope_filter='organization' and p->>'scope'='organization_tree'");
    expect(sql).toContain("jsonb_array_elements(snapshot->'overrides')");
    expect(sql).toContain('create or replace function public.enterprise_save_access_policy');
    expect(sql).not.toContain('where id = target_company and is_active for update');
});
