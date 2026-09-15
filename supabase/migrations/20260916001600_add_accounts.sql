-- Company-scoped chart of accounts. Journals, receivables and payables will post against these
-- codes, so the hierarchy lives here. Account codes are numeric, unlike the alphanumeric codes the
-- other master tables use. Active MFA-verified users read, only administrators write, and rows
-- deactivate instead of deleting.
--
-- Requires 20260915001200_add_audit_logs.sql, which defines private.record_audit().

create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
revoke all on type public.account_type from public;
grant usage on type public.account_type to authenticated;

-- is_postable marks a leaf that may receive journal lines. Summary accounts group their children
-- and never carry a balance of their own.
create table public.accounts (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete restrict,
    parent_id uuid null references public.accounts (id) on delete restrict,
    code text not null,
    name text not null,
    account_type public.account_type not null,
    is_postable boolean not null default true,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid null,
    updated_by uuid null,
    constraint accounts_company_code_key unique (company_id, code),
    constraint accounts_code_format check (code ~ '^[0-9]{3,10}$'),
    constraint accounts_name_not_blank check (btrim(name) <> '')
);

create index accounts_company_id_idx on public.accounts (company_id);
create index accounts_parent_id_idx on public.accounts (parent_id);

alter table public.accounts enable row level security;

revoke all on table public.accounts from public, anon, authenticated;
grant select, insert, update on table public.accounts to authenticated;

create policy "Active users read accounts"
on public.accounts
for select
to authenticated
using ((select private.is_active_user()));

create policy "Active admins insert accounts"
on public.accounts
for insert
to authenticated
with check ((select private.is_admin()));

create policy "Active admins update accounts"
on public.accounts
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create trigger set_accounts_audit_columns
before insert or update on public.accounts
for each row
execute function private.set_master_audit_columns();

-- The hierarchy stays within one company and one account type, never loops, and only hangs from
-- summary accounts. An active account also needs an active parent.
create function private.enforce_account_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    parent record;
    loops boolean;
begin
    if new.is_active and not exists (
        select 1 from public.companies where id = new.company_id and is_active
    ) then
        raise exception using errcode = '22023', message = 'company_inactive';
    end if;

    if new.parent_id is null then
        return new;
    end if;

    if new.parent_id = new.id then
        raise exception using errcode = '22023', message = 'invalid_parent';
    end if;

    select company_id, account_type, is_postable, is_active into parent
    from public.accounts
    where id = new.parent_id;

    if parent is null then
        raise exception using errcode = '22023', message = 'parent_not_found';
    end if;

    if parent.company_id <> new.company_id then
        raise exception using errcode = '22023', message = 'parent_company_mismatch';
    end if;

    if parent.account_type <> new.account_type then
        raise exception using errcode = '22023', message = 'parent_type_mismatch';
    end if;

    if parent.is_postable then
        raise exception using errcode = '22023', message = 'parent_is_postable';
    end if;

    if new.is_active and not parent.is_active then
        raise exception using errcode = '22023', message = 'parent_inactive';
    end if;

    with recursive chain as (
        select id, parent_id from public.accounts where id = new.parent_id
        union all
        select ancestor.id, ancestor.parent_id
        from public.accounts as ancestor
        join chain on ancestor.id = chain.parent_id
    )
    select exists (select 1 from chain where id = new.id) into loops;

    if loops then
        raise exception using errcode = '22023', message = 'invalid_parent';
    end if;

    return new;
end;
$$;

alter function private.enforce_account_parent() owner to postgres;
revoke execute on function private.enforce_account_parent() from public, anon, authenticated;

create trigger enforce_account_parent
before insert or update on public.accounts
for each row
execute function private.enforce_account_parent();

-- Deactivating a summary account deactivates everything beneath it, so no orphan stays postable.
create function private.deactivate_account_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.is_active and not new.is_active then
        update public.accounts
        set is_active = false
        where is_active
          and id in (
                with recursive descendants as (
                    select id from public.accounts where parent_id = new.id
                    union all
                    select child.id
                    from public.accounts as child
                    join descendants on child.parent_id = descendants.id
                )
                select id from descendants
            );
    end if;

    return new;
end;
$$;

alter function private.deactivate_account_children() owner to postgres;
revoke execute on function private.deactivate_account_children() from public, anon, authenticated;

create trigger deactivate_account_children
after update of is_active on public.accounts
for each row
execute function private.deactivate_account_children();

create trigger record_accounts_audit
after insert or update or delete on public.accounts
for each row
execute function private.record_audit();
