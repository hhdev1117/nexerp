import { describe, expect, it } from 'vitest';

const fullyAppliedCatalog = {
    audit_logs_exists: true,
    document_sequences_exists: true,
    items_exists: true,
    warehouses_exists: true,
    accounts_exists: true,
    audit_logs_rls: true,
    document_sequences_rls: true,
    items_rls: true,
    warehouses_rls: true,
    accounts_rls: true,
    audit_write_grants: '0',
    sequence_write_grants: 0,
    item_delete_grants: 0,
    warehouse_delete_grants: 0,
    account_delete_grants: 0,
    audit_policies: 1,
    sequence_policies: 1,
    item_policies: 3,
    warehouse_policies: 3,
    account_policies: 3,
    audit_triggers: 6,
    record_audit_exists: true,
    next_number_exists: true,
    warehouse_guard_exists: true,
    warehouse_cascade_triggers: 1,
    account_guard_exists: true,
    account_cascade_triggers: 1,
    authenticated_can_issue: false,
    legacy_item_menu_keys: 0,
    profile_ui_preferences_exists: true,
    profile_ui_preferences_jsonb: true,
    profile_ui_preferences_not_null: true,
    profile_ui_preferences_default: true,
    profile_ui_preferences_object_constraint: true,
    authenticated_can_update_ui_preferences: true,
    anon_can_update_ui_preferences: false
};

const requiredCheckNames = Object.keys(fullyAppliedCatalog);
const newPreferenceChecks = [
    ['profile_ui_preferences_exists', false],
    ['profile_ui_preferences_jsonb', false],
    ['profile_ui_preferences_not_null', false],
    ['profile_ui_preferences_default', false],
    ['profile_ui_preferences_object_constraint', false],
    ['authenticated_can_update_ui_preferences', false],
    ['anon_can_update_ui_preferences', true]
];

const loadVerifier = () => import('./pending-migration-checks.mjs');

describe('pending migration catalog verification', () => {
    it('passes only after every existing and profile preference catalog contract is present', async () => {
        const { evaluateCatalogChecks } = await loadVerifier();

        const result = evaluateCatalogChecks(fullyAppliedCatalog);

        expect(result.failed).toBe(0);
        expect(result.checks.map(({ key }) => key)).toEqual(requiredCheckNames);
        expect(result.checks.every(({ passed }) => passed)).toBe(true);
    });

    it.each(newPreferenceChecks)('fails when %s has the unsafe value', async (key, unsafeValue) => {
        const { evaluateCatalogChecks } = await loadVerifier();

        const result = evaluateCatalogChecks({ ...fullyAppliedCatalog, [key]: unsafeValue });

        expect(result.failed).toBe(1);
        expect(result.checks.filter(({ passed }) => !passed).map(({ key: failedKey }) => failedKey)).toEqual([key]);
    });
});
