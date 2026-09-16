-- Operational visibility: admin.html previously had no way to tell a healthy, quietly-syncing
-- store apart from one whose PC has been off for a week - both just showed "active". Bumped by
-- store-status (called by every PDA install about once a minute) on every check, active or
-- terminated, so "last seen" tracks whether the install is still reaching us at all, independent
-- of whether you've deactivated it.
alter table public.stores add column last_seen_at timestamptz;

create or replace view public.stores_public
with (security_invoker = true)
as
    select id, name, slug, active, created_at, last_seen_at from public.stores;
