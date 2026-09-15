-- AlexZaxa PDA central schema: multi-store income reporting + role-based dashboard access.
-- All client writes to order_income/stores go through Edge Functions using the service_role
-- key (never shipped to restaurant PCs); RLS below governs read access only, plus a couple of
-- admin-managed tables (store_access) that the admin dashboard writes to directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- stores: one row per restaurant/PDA install
-- ---------------------------------------------------------------------------
create table public.stores (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    secret_hash text not null,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- order_income: one row per completed order (dine-in or phone), append-only
-- ---------------------------------------------------------------------------
create table public.order_income (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete cascade,
    source_order_id integer not null,
    order_kind text not null check (order_kind in ('dine_in', 'phone')),
    receipt_number text,
    opened_at timestamptz,
    closed_at timestamptz,
    subtotal_cents bigint not null default 0,
    discount_cents bigint not null default 0,
    total_cents bigint not null default 0,
    tip_cents bigint not null default 0,
    payment_method text,
    payment_status text,
    waiter_id integer,
    synced_at timestamptz not null default now(),
    unique (store_id, order_kind, source_order_id)
);

create index order_income_store_closed_at_idx on public.order_income (store_id, closed_at desc);

-- ---------------------------------------------------------------------------
-- profiles: one row per website login (mirrors auth.users), carries the role
-- ---------------------------------------------------------------------------
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    role text not null default 'restricted' check (role in ('admin', 'restricted')),
    created_at timestamptz not null default now()
);

-- Auto-create a profiles row whenever a new auth.users row appears (default role: restricted;
-- the admin role is granted manually afterward via SQL, never through client-writable RLS).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email) values (new.id, new.email);
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- store_access: which restricted profiles can see which stores' income
-- ---------------------------------------------------------------------------
create table public.store_access (
    profile_id uuid not null references public.profiles(id) on delete cascade,
    store_id uuid not null references public.stores(id) on delete cascade,
    granted_at timestamptz not null default now(),
    granted_by uuid references public.profiles(id),
    primary key (profile_id, store_id)
);

-- ---------------------------------------------------------------------------
-- pda_releases: publish history backing the update-check manifest / changelog page
-- ---------------------------------------------------------------------------
create table public.pda_releases (
    id uuid primary key default gen_random_uuid(),
    version text not null unique,
    sha256 text not null,
    storage_path text not null,
    published_at timestamptz not null default now(),
    notes text
);

-- ---------------------------------------------------------------------------
-- Helper: is the current auth.uid() an admin? security definer so it can read
-- profiles regardless of the caller's own RLS visibility, without recursion.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.stores enable row level security;
alter table public.order_income enable row level security;
alter table public.profiles enable row level security;
alter table public.store_access enable row level security;
alter table public.pda_releases enable row level security;

-- stores: admin can read everything; no client insert/update/delete (creation goes through
-- the create-store Edge Function, which uses service_role and bypasses RLS entirely).
create policy "stores_select_admin" on public.stores
    for select using (public.is_admin());

-- order_income: admin reads all; restricted users read only stores they've been granted.
-- No insert/update/delete policies at all for anon/authenticated — only the sync-order Edge
-- Function (service_role) can write, so a leaked anon/authenticated key can never forge rows.
create policy "order_income_select" on public.order_income
    for select using (
        public.is_admin()
        or exists (
            select 1 from public.store_access sa
            where sa.profile_id = auth.uid() and sa.store_id = order_income.store_id
        )
    );

-- profiles: each user can read their own row; admin can read all. No client write policies —
-- role changes are made directly by the operator via SQL, not through the app.
create policy "profiles_select_self_or_admin" on public.profiles
    for select using (id = auth.uid() or public.is_admin());

-- store_access: restricted users can see their own grants; admin manages everything.
create policy "store_access_select" on public.store_access
    for select using (profile_id = auth.uid() or public.is_admin());
create policy "store_access_insert_admin" on public.store_access
    for insert with check (public.is_admin());
create policy "store_access_delete_admin" on public.store_access
    for delete using (public.is_admin());

-- pda_releases: public read (powers the changelog page and the update-check manifest with no
-- auth required); no client write policies (publishing is a local operator-only script using
-- service_role).
create policy "pda_releases_select_public" on public.pda_releases
    for select using (true);
