-- QR-code admin login: a PDA install shows a QR code encoding a one-time token; scanning it opens
-- pda-login.html on this site, where signing in as the vendor account (alexzaxa70@gmail.com,
-- enforced in pda-login-approve, not just by role) approves the token, which the PDA is polling
-- for. This is a vendor support/recovery path across every deployed PDA, not a per-customer
-- feature - see pda-login-approve for the actual authorization check.
create table public.pda_login_requests (
    token text primary key,
    license_id text not null,
    store_name text,
    status text not null default 'pending' check (status in ('pending', 'approved', 'consumed')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index pda_login_requests_expires_at_idx on public.pda_login_requests (expires_at);

-- No public policies - every access path goes through the pda-login-* Edge Functions using
-- service_role, same posture as license_keys/stores.
alter table public.pda_login_requests enable row level security;
