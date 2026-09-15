-- Public bucket for PDA release zips + latest.json manifest. Public READ only (this is exactly
-- what the old GitHub Pages hosting provided — no auth needed to check for/download updates);
-- all writes happen via the operator's own machine using service_role (scripts/publish-release),
-- never through a client-facing policy.
insert into storage.buckets (id, name, public)
values ('pda-releases', 'pda-releases', true)
on conflict (id) do nothing;

create policy "pda_releases_bucket_public_read" on storage.objects
    for select using (bucket_id = 'pda-releases');
