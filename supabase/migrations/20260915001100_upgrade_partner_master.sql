-- Upgrade installations that already received the earlier partner master schema.
-- Fresh installations receive these fields from 20260915001000; IF NOT EXISTS keeps this safe.
alter table public.partners
    add column if not exists contact_name text not null default '',
    add column if not exists payment_terms_days integer not null default 30,
    add column if not exists credit_limit numeric(18,0) not null default 0;

do $$
begin
    if not exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.partners'::pg_catalog.regclass
          and conname = 'partners_payment_terms_nonnegative'
    ) then
        alter table public.partners
            add constraint partners_payment_terms_nonnegative check (payment_terms_days >= 0);
    end if;

    if not exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.partners'::pg_catalog.regclass
          and conname = 'partners_credit_limit_nonnegative'
    ) then
        alter table public.partners
            add constraint partners_credit_limit_nonnegative check (credit_limit >= 0);
    end if;
end;
$$;
