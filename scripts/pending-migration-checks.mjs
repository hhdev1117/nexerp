export const expectedCatalogChecks = Object.freeze({
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
    audit_write_grants: 0,
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
});

const normalizeCatalogValue = (value) => (typeof value === 'string' ? Number(value) : value);

export const evaluateCatalogChecks = (actual) => {
    const checks = Object.entries(expectedCatalogChecks).map(([key, want]) => {
        const got = normalizeCatalogValue(actual[key]);
        return { key, got, want, passed: got === want };
    });

    return {
        checks,
        failed: checks.filter(({ passed }) => !passed).length
    };
};
