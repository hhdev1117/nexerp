-- Requires the local Supabase stack (`npx supabase start`) and pgTAP runner
-- (`npx supabase test db`). The CLI applies migrations before executing tests.
begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('20000000-0000-0000-0000-000000000001', 'member@nexerp.internal', '{}'::jsonb, '{"login_id":"member","nexerp_provisioned":true}'::jsonb),
    ('20000000-0000-0000-0000-000000000002', 'adminuser@nexerp.internal', '{}'::jsonb, '{"login_id":"adminuser","nexerp_provisioned":true}'::jsonb),
    ('20000000-0000-0000-0000-000000000003', 'inactive@nexerp.internal', '{}'::jsonb, '{"login_id":"inactive","nexerp_provisioned":true}'::jsonb);

update public.profiles
set role = 'admin'::public.app_role
where id = '20000000-0000-0000-0000-000000000002'::uuid;

update public.profiles
set is_active = false
where id = '20000000-0000-0000-0000-000000000003'::uuid;

select ok(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.role_menu_permissions'::regclass),
    'role menu permissions has row-level security enabled'
);

select ok(
    not pg_catalog.has_table_privilege('anon', 'public.role_menu_permissions', 'SELECT'),
    'anonymous clients have no select grant on role menu permissions'
);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is_empty(
    $$select role from public.role_menu_permissions$$,
    'an AAL1 user cannot read role permissions'
);

select is_empty(
    $$select role from public.role_menu_permissions where role = 'approver'::public.app_role$$,
    'an ordinary user cannot read another role permissions row'
);

select throws_ok(
    $$update public.role_menu_permissions set allowed_menu_keys = array['dashboard'] where role = 'user'::public.app_role$$,
    '42501',
    'permission denied for table role_menu_permissions',
    'authenticated users cannot update menu permissions directly'
);

select throws_ok(
    $$delete from public.role_menu_permissions where role = 'user'::public.app_role$$,
    '42501',
    'permission denied for table role_menu_permissions',
    'authenticated users cannot delete menu permissions directly'
);

select throws_ok(
    $$select * from public.admin_replace_role_menu_permissions('user'::public.app_role, array['dashboard'], 1)$$,
    '42501',
    'admin_required',
    'an ordinary user cannot invoke the administrator permission RPC'
);

select throws_ok(
    $$select * from public.admin_update_profile('20000000-0000-0000-0000-000000000003'::uuid, 'Inactive', 'Sales', 'user'::public.app_role, true)$$,
    '42501',
    'admin_required',
    'an ordinary user cannot invoke the administrator profile RPC'
);

select throws_ok(
    $$select * from public.admin_update_profile_status('20000000-0000-0000-0000-000000000003'::uuid, true)$$,
    '42501',
    'admin_required',
    'an ordinary user cannot invoke the administrator profile status RPC'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is_empty(
    $$select role from public.role_menu_permissions$$,
    'an inactive user cannot read their role permissions'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is_empty(
    $$select role from public.role_menu_permissions$$,
    'an AAL1 administrator cannot read role permissions'
);

select throws_ok(
    $$select * from public.admin_update_profile_status('20000000-0000-0000-0000-000000000003'::uuid, true)$$,
    '42501',
    'admin_required',
    'an AAL1 administrator cannot invoke administrator RPCs'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select results_eq(
    $$select count(*) from public.role_menu_permissions$$,
    $$values (3::bigint)$$,
    'an AAL2 administrator reads every role permissions row'
);

select throws_ok(
    $$update public.role_menu_permissions set allowed_menu_keys = array['dashboard'] where role = 'user'::public.app_role$$,
    '42501',
    'permission denied for table role_menu_permissions',
    'an administrator also cannot bypass the permission RPC with a direct update'
);

select results_eq(
    $$select role, allowed_menu_keys, revision, updated_by from public.admin_replace_role_menu_permissions('approver'::public.app_role, array['sales.orders', 'dashboard'], 1)$$,
    $$values ('approver'::public.app_role, array['dashboard', 'sales.orders']::text[], 2::bigint, '20000000-0000-0000-0000-000000000002'::uuid)$$,
    'an administrator atomically replaces permissions and advances the revision'
);

select results_eq(
    $$select revision from public.role_menu_permissions where role = 'approver'::public.app_role$$,
    $$values (2::bigint)$$,
    'the replaced permission row persists the advanced revision'
);

select throws_ok(
    $$select * from public.admin_replace_role_menu_permissions('approver'::public.app_role, array['dashboard'], 1)$$,
    '40001',
    'revision_conflict',
    'stale revisions cannot overwrite a newer permission set'
);

select throws_ok(
    $$select * from public.admin_replace_role_menu_permissions('admin'::public.app_role, array['dashboard'], 1)$$,
    '22023',
    'admin_role_permissions_locked',
    'the administrator role cannot be changed through the permission RPC'
);

select throws_ok(
    $$select * from public.admin_update_profile('20000000-0000-0000-0000-000000000002'::uuid, 'Admin', 'IT', 'user'::public.app_role, true)$$,
    '22023',
    'self_demotion_forbidden',
    'an administrator cannot demote their own account'
);

select throws_ok(
    $$select * from public.admin_update_profile('20000000-0000-0000-0000-000000000002'::uuid, 'Admin', 'IT', 'admin'::public.app_role, false)$$,
    '22023',
    'self_deactivation_forbidden',
    'an administrator cannot deactivate their own account'
);

select throws_ok(
    $$select * from public.admin_update_profile_status('20000000-0000-0000-0000-000000000002'::uuid, false)$$,
    '22023',
    'self_deactivation_forbidden',
    'an administrator cannot deactivate their own account through the status RPC'
);

select results_eq(
    $$select id, display_name, department, role, is_active from public.admin_update_profile('20000000-0000-0000-0000-000000000001'::uuid, 'Member One', 'Sales', 'approver'::public.app_role, false)$$,
    $$values ('20000000-0000-0000-0000-000000000001'::uuid, 'Member One'::text, 'Sales'::text, 'approver'::public.app_role, false)$$,
    'an administrator can update another account through the protected RPC'
);

select results_eq(
    $$select display_name, department, role, is_active from public.admin_update_profile_status('20000000-0000-0000-0000-000000000001'::uuid, true)$$,
    $$values ('Member One'::text, 'Sales'::text, 'approver'::public.app_role, true)$$,
    'a status update preserves the latest profile fields'
);

reset role;

select throws_ok(
    $$update public.role_menu_permissions set allowed_menu_keys = array['dashboard'] where role = 'admin'::public.app_role$$,
    '55000',
    'admin_role_permissions_immutable',
    'the administrator permission row is immutable even for table owners'
);

select throws_ok(
    $$delete from public.role_menu_permissions where role = 'admin'::public.app_role$$,
    '55000',
    'admin_role_permissions_immutable',
    'the administrator permission row cannot be deleted'
);

select results_eq(
    $$select role, is_active from public.profiles where id = '20000000-0000-0000-0000-000000000002'::uuid$$,
    $$values ('admin'::public.app_role, true)$$,
    'failed self-lockout attempts leave the administrator active'
);

select * from finish();
rollback;
