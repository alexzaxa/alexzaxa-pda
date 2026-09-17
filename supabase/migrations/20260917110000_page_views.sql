-- Minimal, privacy-friendly page-view counter for the public marketing/help pages: no cookies,
-- no client fingerprinting, no IP capture (unlike ticket_rate_limiting, which stores IP purely
-- for abuse prevention) - just which path was viewed and, optionally, where from. Same
-- insert-public/select-admin RLS shape as support_tickets.
create table public.page_views (
    id bigint generated always as identity primary key,
    path text not null check (char_length(path) between 1 and 200),
    referrer text check (referrer is null or char_length(referrer) <= 500),
    created_at timestamptz not null default now()
);

create index page_views_created_at_idx on public.page_views (created_at desc);

alter table public.page_views enable row level security;

create policy "page_views_insert_public" on public.page_views
    for insert with check (true);
create policy "page_views_select_admin" on public.page_views
    for select using (public.is_admin());
