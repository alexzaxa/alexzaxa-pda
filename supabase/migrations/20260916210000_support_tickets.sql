-- Support tickets submitted from the public help page (help.html) by restaurant staff using the
-- PDA - not by anyone with a website login. Anyone can insert (no account required, since a
-- waiter/register user has no alexzaxa-pda login at all); only admin can read, update, or delete,
-- exactly like every other admin-only table in this schema (see is_admin() in init_schema).
create table public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    store_name text not null check (char_length(store_name) between 1 and 200),
    contact_name text not null check (char_length(contact_name) between 1 and 200),
    contact_info text not null check (char_length(contact_info) between 1 and 200),
    category text not null check (category in ('technical', 'how_to', 'billing', 'other')),
    message text not null check (char_length(message) between 1 and 5000),
    status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
    admin_notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index support_tickets_status_created_idx on public.support_tickets (status, created_at desc);

alter table public.support_tickets enable row level security;

-- Public submission: no auth required, and no read-back of what was just inserted (PostgREST
-- inserts don't need select afterward here - help.html just shows a static "thanks" message).
create policy "support_tickets_insert_public" on public.support_tickets
    for insert with check (true);

create policy "support_tickets_select_admin" on public.support_tickets
    for select using (public.is_admin());
create policy "support_tickets_update_admin" on public.support_tickets
    for update using (public.is_admin()) with check (public.is_admin());
create policy "support_tickets_delete_admin" on public.support_tickets
    for delete using (public.is_admin());
