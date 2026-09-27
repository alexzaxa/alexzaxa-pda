-- Links a self-registered store back to the license that created it, so the admin dashboard can
-- see which license a given store came from (register-store, a new public Edge Function called
-- by the PDA exe itself right after license activation - see claim-license for the equivalent
-- license-side pattern). Nullable: stores created the old way, directly from the admin dashboard's
-- "New store" form, have no license_id.
alter table public.stores add column license_id text references public.license_keys(license_id);
