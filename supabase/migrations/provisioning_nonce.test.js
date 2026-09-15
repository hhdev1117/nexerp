import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(path.join(import.meta.dirname, '20260915000100_add_provisioning_nonces.sql'), 'utf8');

describe('one-time user provisioning migration', () => {
    it('requires and consumes a server-staged nonce before creating a profile', () => {
        expect(migration).toMatch(/create table private\.user_provisioning_nonces/i);
        expect(migration).toMatch(/create or replace function public\.prepare_user_provisioning/i);
        expect(migration).toMatch(/new\.raw_user_meta_data\s*->>\s*'provisioning_nonce'/i);
        expect(migration).toMatch(/delete from private\.user_provisioning_nonces/i);
        expect(migration).toMatch(/if not found then[\s\S]*provisioning_required/i);
        expect(migration).toMatch(/grant execute on function public\.prepare_user_provisioning\(text, text\) to service_role/i);
        expect(migration).not.toMatch(/grant execute on function public\.prepare_user_provisioning\(text, text\) to (anon|authenticated)/i);
    });
});
