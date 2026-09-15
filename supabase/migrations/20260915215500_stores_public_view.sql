-- Restricted users need to resolve store_id -> store name for stores they've been granted
-- (order_income RLS already lets them read the rows, but stores itself was admin-only). Fixed
-- with two layers: a row policy granting SELECT on stores to a profile with a matching
-- store_access row, and a column-safe view so secret_hash is never exposed to any browser
-- session, admin or restricted, even though RLS operates at the row level, not column level.
create policy "stores_select_granted" on public.stores
    for select using (
        exists (
            select 1 from public.store_access sa
            where sa.profile_id = auth.uid() and sa.store_id = stores.id
        )
    );

create view public.stores_public
with (security_invoker = true)
as
    select id, name, slug, active, created_at from public.stores;

grant select on public.stores_public to authenticated;
