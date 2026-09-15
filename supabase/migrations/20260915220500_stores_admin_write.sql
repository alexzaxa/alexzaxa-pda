-- Lets the admin deactivate/reactivate or permanently delete a store directly from the
-- dashboard (same trust model already used for store_access: the admin's own authenticated
-- session, gated by is_admin(), not a service_role bypass). order_income and store_access both
-- have `references stores(id) on delete cascade`, so a hard delete also erases that store's
-- income history and access grants - the admin UI warns about this before calling it.
create policy "stores_update_admin" on public.stores
    for update using (public.is_admin()) with check (public.is_admin());

create policy "stores_delete_admin" on public.stores
    for delete using (public.is_admin());
