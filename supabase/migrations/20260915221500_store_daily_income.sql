-- Daily per-store income totals, computed in Postgres rather than fetched-and-summed client-side
-- (the previous dashboard/admin queries fetched up to 500 raw order rows, which both showed more
-- detail than needed and silently truncated totals for any store doing high order volume). This
-- view is security_invoker, so it still respects order_income's own RLS row-by-row before
-- aggregating - a restricted user querying it only ever sees totals for stores they're granted.
create view public.store_daily_income
with (security_invoker = true)
as
    select
        store_id,
        (closed_at at time zone 'utc')::date as day,
        count(*) as orders,
        sum(total_cents) as total_cents
    from public.order_income
    where closed_at is not null
    group by store_id, (closed_at at time zone 'utc')::date;

grant select on public.store_daily_income to authenticated;
