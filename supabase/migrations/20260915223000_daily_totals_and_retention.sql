-- Splits "detailed recent history" from "permanent daily totals": order_income (raw, one row
-- per order) will be pruned after 15 days by a scheduled job below, but store_daily_totals is a
-- real, permanent table that's incremented via trigger as each order lands, so daily totals
-- (and Excel exports of them) stay available forever even after the raw rows are gone.
create table public.store_daily_totals (
    store_id uuid not null references public.stores(id) on delete cascade,
    day date not null,
    orders integer not null default 0,
    total_cents bigint not null default 0,
    primary key (store_id, day)
);

alter table public.store_daily_totals enable row level security;

create policy "store_daily_totals_select" on public.store_daily_totals
    for select using (
        public.is_admin()
        or exists (
            select 1 from public.store_access sa
            where sa.profile_id = auth.uid() and sa.store_id = store_daily_totals.store_id
        )
    );
-- No insert/update/delete policies for any client role - only the trigger below (running as
-- the table owner) writes to this table.

create or replace function public.bump_daily_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.closed_at is not null then
        insert into public.store_daily_totals (store_id, day, orders, total_cents)
        values (new.store_id, (new.closed_at at time zone 'utc')::date, 1, new.total_cents)
        on conflict (store_id, day) do update
            set orders = store_daily_totals.orders + 1,
                total_cents = store_daily_totals.total_cents + excluded.total_cents;
    end if;
    return new;
end;
$$;

create trigger trg_order_income_bump_daily_total
    after insert on public.order_income
    for each row execute function public.bump_daily_total();

-- Backfill totals for whatever order_income rows already exist, so nothing already-synced is
-- lost when the 15-day cleanup below starts running.
insert into public.store_daily_totals (store_id, day, orders, total_cents)
select store_id, (closed_at at time zone 'utc')::date as day, count(*), sum(total_cents)
from public.order_income
where closed_at is not null
group by store_id, (closed_at at time zone 'utc')::date
on conflict (store_id, day) do update
    set orders = excluded.orders,
        total_cents = excluded.total_cents;

-- Now superseded by the permanent table above - kept as a thin passthrough only if anything
-- still queries it, but new code should use store_daily_totals directly.
drop view if exists public.store_daily_income;

-- 15-day retention on the raw ledger. pg_cron runs inside Postgres itself (no Edge Function
-- round-trip needed for a plain DELETE); store_daily_totals already has the permanent totals
-- via the trigger above, so this only ever removes detail that's no longer needed.
create extension if not exists pg_cron with schema extensions;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'prune-order-income') then
        perform cron.unschedule('prune-order-income');
    end if;
end;
$$;

select cron.schedule(
    'prune-order-income',
    '0 3 * * *',
    $$delete from public.order_income where closed_at < (now() - interval '15 days')$$
);
