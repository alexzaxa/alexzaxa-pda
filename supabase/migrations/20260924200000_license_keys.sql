-- Ledger of AlexZaxa PDA license keys issued from the admin dashboard. Rows are written only by
-- the generate-license-key Edge Function (service_role), after it verifies the caller is an
-- admin - same trust model as admin_audit_log. This table has no authority over whether a key
-- actually works: validity is entirely determined offline by app.py verifying the Ed25519
-- signature embedded in the key string itself. This is purely a "what did we issue, to whom, and
-- when" record for the admin.
create table public.license_keys (
    id bigint generated always as identity primary key,
    license_id text not null unique,
    key text not null,
    expires_at date,
    note text,
    issued_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
);

alter table public.license_keys enable row level security;

create policy "license_keys_select_admin" on public.license_keys
    for select using (public.is_admin());
