import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./20260915001100_upgrade_partner_master.sql', import.meta.url), 'utf8');

describe('partner master upgrade migration', () => {
    it('adds the three fields missing from the previously deployed schema without replacing data', () => {
        expect(migration).toContain('add column if not exists contact_name');
        expect(migration).toContain('add column if not exists payment_terms_days');
        expect(migration).toContain('add column if not exists credit_limit');
        expect(migration).not.toMatch(/drop\s+table|truncate|delete\s+from/i);
    });

    it('adds nonnegative checks only when they are absent', () => {
        expect(migration).toContain("conname = 'partners_payment_terms_nonnegative'");
        expect(migration).toContain("conname = 'partners_credit_limit_nonnegative'");
        expect(migration).toContain('check (payment_terms_days >= 0)');
        expect(migration).toContain('check (credit_limit >= 0)');
    });
});
