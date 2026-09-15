// Local PostgreSQL verification: uses the isolated existing SQL-check dependency.
import { PGlite } from '../../.cache/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const firstUser = 'a2000000-0000-0000-0000-000000000001';
const secondUser = 'a2000000-0000-0000-0000-000000000002';
const inactiveUser = 'a2000000-0000-0000-0000-000000000003';
const migrationPath = 'supabase/migrations/20260916001700_add_profile_ui_preferences.sql';
const db = new PGlite();

await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (
        id uuid primary key,
        email text not null,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        raw_app_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$select current_setting('request.jwt.claim.sub', true)::uuid$$;
    grant usage on schema auth to authenticated;
`);

await db.exec(fs.readFileSync('supabase/migrations/20260911000100_create_profiles.sql', 'utf8'));
assert.equal(fs.existsSync(migrationPath), true, 'the profile UI preferences migration must exist');
await db.exec(fs.readFileSync(migrationPath, 'utf8'));

let checks = 0;
const eq = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
};
const rejects = async (run, code) => {
    await assert.rejects(run, (error) => error.code === code);
    checks++;
};
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const columnPrivilege = async (role, column, privilege) => (await rows('select pg_catalog.has_column_privilege($1, $2, $3, $4) granted', [role, 'public.profiles', column, privilege]))[0].granted;
const tablePrivilege = async (role, privilege) => (await rows('select pg_catalog.has_table_privilege($1, $2, $3) granted', [role, 'public.profiles', privilege]))[0].granted;
const asUser = (id) => db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`);
const asOwner = () => db.exec('reset role;');

await db.query(
    `insert into auth.users (id, email)
     values ($1, 'preferences-one@gmail.com'), ($2, 'preferences-two@gmail.com'), ($3, 'preferences-inactive@gmail.com')`,
    [firstUser, secondUser, inactiveUser]
);

eq(
    (await rows('select ui_preferences from public.profiles where id = $1', [firstUser]))[0].ui_preferences,
    {}
);
await rejects(() => db.query("update public.profiles set ui_preferences = '[]'::jsonb where id = $1", [firstUser]), '23514');
await rejects(() => db.query('update public.profiles set ui_preferences = null where id = $1', [firstUser]), '23502');

eq(await columnPrivilege('authenticated', 'ui_preferences', 'UPDATE'), true);
eq(await columnPrivilege('anon', 'ui_preferences', 'UPDATE'), false);
eq(await columnPrivilege('authenticated', 'role', 'UPDATE'), false);
eq(await tablePrivilege('authenticated', 'DELETE'), false);

eq(
    await rows("select policyname from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'"),
    [{ policyname: 'Active users update their profile' }]
);

await asUser(firstUser);
await db.query('update public.profiles set ui_preferences = $2::jsonb where id = $1', [firstUser, JSON.stringify({ darkTheme: true, menuMode: 'static' })]);
eq((await rows('select ui_preferences from public.profiles'))[0].ui_preferences, { darkTheme: true, menuMode: 'static' });
await db.query('update public.profiles set ui_preferences = $2::jsonb where id = $1', [secondUser, JSON.stringify({ darkTheme: true })]);
await rejects(() => db.query("update public.profiles set role = 'admin' where id = $1", [firstUser]), '42501');
await rejects(() => db.query('delete from public.profiles where id = $1', [firstUser]), '42501');

await asOwner();
eq((await rows('select ui_preferences from public.profiles where id = $1', [secondUser]))[0].ui_preferences, {});
await db.query('update public.profiles set is_active = false where id = $1', [inactiveUser]);
await asUser(inactiveUser);
await db.query('update public.profiles set ui_preferences = $2::jsonb where id = $1', [inactiveUser, JSON.stringify({ darkTheme: true })]);
await asOwner();
eq((await rows('select ui_preferences from public.profiles where id = $1', [inactiveUser]))[0].ui_preferences, {});

console.log(`Profile UI preferences migration: ${checks} PostgreSQL runtime assertions passed.`);
await db.close();
