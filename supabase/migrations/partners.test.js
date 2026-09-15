import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./20260915001000_add_partners.sql', import.meta.url), 'utf8');

describe('partner master migration', () => {
    it('creates the company-scoped ledger and constraints', () => {
        expect(migration).toContain('create table public.partners');
        for (const column of ['company_id', 'business_number', 'is_customer', 'is_vendor', 'payment_terms_days', 'credit_limit', 'is_active', 'created_by', 'updated_by']) expect(migration).toContain(column);
        expect(migration).toContain('partners_company_code_key unique (company_id, code)');
        expect(migration).toContain('create unique index partners_company_business_number_key');
        expect(migration).toContain('(is_customer or is_vendor)');
    });
    it('enforces RLS, audit ownership and inactive-company rules', () => {
        expect(migration).toContain('alter table public.partners enable row level security');
        expect(migration).toContain('grant select, insert, update on table public.partners to authenticated');
        expect(migration).not.toMatch(/grant[^;]*delete/i);
        expect(migration.match(/create policy/g)).toHaveLength(3);
        expect(migration).toContain('private.set_master_audit_columns()');
        expect(migration).toContain('private.enforce_partner_company_active()');
        expect(migration).toContain("security definer\nset search_path = ''");
        expect(migration).toContain("message = 'company_inactive'");
    });
    it('moves legacy navigation permissions to master.partners', () => {
        expect(migration).toContain("'sales.customers'");
        expect(migration).toContain("'purchasing.vendors'");
        expect(migration).toContain("'master.partners'");
        expect(migration).toContain('role_menu_permissions');
        expect(migration).toContain('enterprise_access_policies');
        expect(migration).toContain('enterprise_access_publications');
        expect(migration).toContain('create or replace function private.enterprise_resources()');
    });
});
